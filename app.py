import os
import json
import asyncio
import datetime
from zoneinfo import ZoneInfo

import requests
import edge_tts
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, stream_with_context
from groq import Groq

load_dotenv(override=True)  # .env wins over any stale GROQ_API_KEY set in the OS

app = Flask(__name__)
client = Groq()  # reads GROQ_API_KEY from the environment

LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-oss-120b")  # override in .env if Groq renames it
STT_MODEL = "whisper-large-v3"
MAX_HISTORY = 20        # messages of context sent to the LLM
MAX_TOOL_ROUNDS = 3     # how many tool-call loops before forcing a final answer
MAX_TTS_CHARS = 600

# ==========================================
# 1. Voices & personas
# ==========================================
VOICES = {
    "en-US-AriaNeural": "Aria (US, female)",
    "en-US-GuyNeural": "Guy (US, male)",
    "en-GB-SoniaNeural": "Sonia (UK, female)",
    "en-GB-RyanNeural": "Ryan (UK, male)",
    "en-AU-NatashaNeural": "Natasha (AU, female)",
}
DEFAULT_VOICE = "en-US-AriaNeural"

VOICE_RULES = (
    " Your replies are spoken aloud, so use plain spoken English: no markdown, "
    "no bullet lists, no emojis, and never read out URLs. Keep answers to 2-3 "
    "sentences unless the user asks for more detail."
)

PERSONAS = {
    "friendly": {
        "label": "Buddie (friendly)",
        "prompt": "You are Buddie, a concise, friendly voice assistant. Keep answers conversational and clear.",
    },
    "professional": {
        "label": "Professional assistant",
        "prompt": "You are Buddie, a polished professional assistant. Be precise, courteous and efficient, and avoid slang.",
    },
    "sarcastic": {
        "label": "Sarcastic best friend",
        "prompt": (
            "You are Buddie, the user's sarcastic best friend. Tease them playfully with dry wit, "
            "but stay warm and never be cruel. Still give a genuinely correct, useful answer."
        ),
    },
    "code_mentor": {
        "label": "Code mentor",
        "prompt": (
            "You are Buddie, a patient senior software engineer mentoring the user. Explain ideas "
            "step by step with simple analogies. Describe code in words rather than reading symbols aloud."
        ),
    },
}
DEFAULT_PERSONA = "friendly"


# ==========================================
# 2. Tools (function calling)
# ==========================================
WMO_CODES = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "foggy", 48: "foggy", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow",
    75: "heavy snow", 80: "rain showers", 81: "rain showers", 82: "violent rain showers",
    95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
}


def tool_get_datetime(ctx, timezone=None, **_):
    tz_name = timezone or ctx.get("tz") or "UTC"
    try:
        now = datetime.datetime.now(ZoneInfo(tz_name))
    except Exception:
        return {"error": f"Unknown timezone '{tz_name}'. Use an IANA name like 'Asia/Karachi'."}
    return {
        "timezone": tz_name,
        "date": now.strftime("%A, %d %B %Y"),
        "time": now.strftime("%I:%M %p"),
    }


def tool_get_weather(ctx, location, **_):
    try:
        geo = requests.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": location, "count": 1},
            timeout=6,
        ).json()
        if not geo.get("results"):
            return {"error": f"Could not find a place called '{location}'."}
        place = geo["results"][0]
        cur = requests.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "current": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
                "timezone": "auto",
            },
            timeout=6,
        ).json()["current"]
    except Exception as exc:
        return {"error": f"Weather service unavailable: {exc}"}
    return {
        "place": f"{place['name']}, {place.get('country', '')}".strip(", "),
        "conditions": WMO_CODES.get(cur.get("weather_code"), "unknown"),
        "temperature_c": cur["temperature_2m"],
        "feels_like_c": cur["apparent_temperature"],
        "humidity_percent": cur["relative_humidity_2m"],
        "wind_kmh": cur["wind_speed_10m"],
    }


def tool_web_search(ctx, query, **_):
    try:
        try:
            from ddgs import DDGS
        except ImportError:  # older package name
            from duckduckgo_search import DDGS
        results = DDGS().text(query, max_results=4)
    except Exception as exc:
        return {"error": f"Search failed: {exc}"}
    return {
        "results": [
            {"title": r.get("title"), "snippet": (r.get("body") or "")[:300]}
            for r in results
        ]
    }


TOOL_IMPL = {
    "get_current_datetime": tool_get_datetime,
    "get_weather": tool_get_weather,
    "web_search": tool_web_search,
}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_current_datetime",
            "description": "Get the current date and time. Use for any question about today's date, the time, or the day of the week.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": "IANA timezone such as 'Asia/Karachi'. Omit to use the user's own timezone.",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a city or place.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string", "description": "City or place name, e.g. 'Islamabad'."}},
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current events, recent facts, or anything you are unsure about.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "A short search query."}},
                "required": ["query"],
            },
        },
    },
]


def run_tool(name, raw_args, ctx):
    fn = TOOL_IMPL.get(name)
    if not fn:
        return json.dumps({"error": f"Unknown tool '{name}'"})
    try:
        args = json.loads(raw_args) if raw_args else {}
        if not isinstance(args, dict):
            args = {}
        return json.dumps(fn(ctx, **args))
    except TypeError as exc:
        return json.dumps({"error": f"Bad arguments: {exc}"})
    except Exception as exc:
        return json.dumps({"error": str(exc)})


# ==========================================
# 3. Streaming LLM loop (SSE)
# ==========================================
def sse(payload):
    return f"data: {json.dumps(payload)}\n\n"


def sanitize_history(raw):
    clean = []
    if isinstance(raw, list):
        for m in raw:
            if (
                isinstance(m, dict)
                and m.get("role") in ("user", "assistant")
                and isinstance(m.get("content"), str)
                and m["content"].strip()
            ):
                clean.append({"role": m["role"], "content": m["content"][:2000]})
    return clean[-MAX_HISTORY:]


def open_stream(messages, use_tools):
    kwargs = dict(model=LLM_MODEL, messages=messages, stream=True, temperature=0.6, max_tokens=1500)  # gpt-oss counts its hidden reasoning in this limit
    if use_tools:
        kwargs.update(tools=TOOLS, tool_choice="auto")
    return client.chat.completions.create(**kwargs)


def stream_reply(messages, ctx):
    """Yield SSE frames. Streams tokens, runs tools when the model asks, then continues."""
    use_tools = True
    rounds = 0

    while True:
        emitted = False
        content_parts = []
        calls = {}  # index -> {id, name, args}

        try:
            for chunk in open_stream(messages, use_tools):
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    emitted = True
                    content_parts.append(delta.content)
                    yield sse({"type": "token", "text": delta.content})
                for tc in delta.tool_calls or []:
                    slot = calls.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            slot["name"] = tc.function.name
                        if tc.function.arguments:
                            slot["args"] += tc.function.arguments
        except Exception as exc:
            app.logger.warning("LLM stream error: %s", exc)
            # Llama occasionally emits a malformed tool call. Retry once without tools.
            if use_tools and not emitted and not calls:
                use_tools = False
                continue
            yield sse({"type": "error", "message": str(exc)})
            return

        if not calls:
            yield sse({"type": "done"})
            return

        rounds += 1
        if rounds >= MAX_TOOL_ROUNDS:
            use_tools = False  # force a plain-text answer next loop

        ordered = [calls[i] for i in sorted(calls)]
        messages.append({
            "role": "assistant",
            "content": "".join(content_parts) or None,
            "tool_calls": [
                {"id": c["id"], "type": "function",
                 "function": {"name": c["name"], "arguments": c["args"] or "{}"}}
                for c in ordered
            ],
        })
        for c in ordered:
            yield sse({"type": "tool", "name": c["name"]})
            messages.append({
                "role": "tool",
                "tool_call_id": c["id"],
                "content": run_tool(c["name"], c["args"], ctx),
            })


# ==========================================
# 4. Routes
# ==========================================
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config")
def config():
    return jsonify({
        "voices": [{"id": k, "label": v} for k, v in VOICES.items()],
        "personas": [{"id": k, "label": v["label"]} for k, v in PERSONAS.items()],
        "defaults": {"voice": DEFAULT_VOICE, "persona": DEFAULT_PERSONA},
    })


@app.route("/api/transcribe", methods=["POST"])
def transcribe():
    audio = request.files.get("audio")
    if audio is None:
        return jsonify({"error": "No audio file provided"}), 400
    data = audio.read()
    if len(data) < 1000:
        return jsonify({"text": ""})
    try:
        result = client.audio.transcriptions.create(
            file=(audio.filename or "speech.wav", data),
            model=STT_MODEL,
            temperature=0,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return jsonify({"text": (result.text or "").strip()})


@app.route("/api/chat/stream", methods=["POST"])
def chat_stream():
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Empty message"}), 400

    persona = PERSONAS.get(body.get("persona"), PERSONAS[DEFAULT_PERSONA])
    ctx = {"tz": body.get("tz") if isinstance(body.get("tz"), str) else None}
    messages = (
        [{"role": "system", "content": persona["prompt"] + VOICE_RULES}]
        + sanitize_history(body.get("history"))
        + [{"role": "user", "content": text[:2000]}]
    )

    return Response(
        stream_with_context(stream_reply(messages, ctx)),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


async def synthesize(text, voice):
    audio = bytearray()
    async for chunk in edge_tts.Communicate(text, voice).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)


@app.route("/api/tts", methods=["POST"])
def tts():
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()[:MAX_TTS_CHARS]
    voice = body.get("voice") if body.get("voice") in VOICES else DEFAULT_VOICE
    if not text:
        return jsonify({"error": "Empty text"}), 400
    try:
        audio = asyncio.run(synthesize(text, voice))
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502
    return Response(audio, mimetype="audio/mpeg")


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG") == "1", threaded=True)