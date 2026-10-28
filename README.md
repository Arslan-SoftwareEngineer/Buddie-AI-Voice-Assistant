# 🎙️ Buddie AI Voice Assistant

**A hands-free, voice-first AI assistant that listens, thinks, uses live tools and talks back.**

[![Python](https://img.shields.io/badge/Python-3.x-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-Framework-green.svg)](https://flask.palletsprojects.com/)
[![Groq](https://img.shields.io/badge/AI-Groq-red.svg)](https://groq.com/)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black.svg)](https://vercel.com/)

---

## 🚀 Overview

**Buddie** is a web-based voice assistant built for natural, continuous conversation. Press one button and just talk: Buddie detects when you start and stop speaking, transcribes you, streams its answer as it is being written, and speaks it back sentence by sentence. It can also look things up, such as the weather, the time and the web, instead of relying only on what the model already knows.

The default screen is voice-only: a live waveform and a mic button. A toggle reveals the full transcript and a text box whenever you want them.

---

## 🌟 Key Features

### Voice experience
- **🎧 Ambient listening (client-side VAD):** [`@ricky0123/vad-web`](https://github.com/ricky0123/vad) runs a small ONNX model in your browser. It detects when you start and stop talking, so there is no button to hold and no fixed recording window.
- **🌊 Live waveform visualizer:** The Web Audio API (`AnalyserNode`) draws a glowing equalizer on a canvas. It reacts to your microphone and to Buddie's voice, and the screen lights up while Buddie hears you.
- **🗣️ Voice selector:** Switch between five `edge-tts` voices (Aria, Guy, Sonia, Ryan, Natasha) on the fly.
- **🎭 Persona selector:** Friendly Buddie, Professional Assistant, Sarcastic Best Friend or Code Mentor.

### Speed
- **⚡ Token streaming (Server-Sent Events):** The reply is streamed from the LLM to the browser as it is generated, so text appears immediately.
- **🔊 Sentence-level speech:** Each finished sentence is sent to text-to-speech right away and queued, so Buddie starts talking before the full answer exists.
- **🚀 Fast inference:** Speech-to-text (`whisper-large-v3`) and the language model both run on Groq.

### Intelligence
- **🛠️ Function calling:** Buddie decides when to use a tool.
  - 🕐 **Date and time**, in your own timezone or any other.
  - 🌦️ **Live weather** for any city, via [Open-Meteo](https://open-meteo.com/) (no API key needed).
  - 🔎 **Web search** via DuckDuckGo for current events and recent facts.
- **🧠 Context-aware chat:** The last 20 messages are sent with each request.

### Polish
- **💾 Persistent chat sessions:** Conversations are saved in your browser's `localStorage`, with a sidebar to switch between or delete chats. Nothing is lost on refresh.
- **📝 Markdown export:** Download any conversation as a `.md` transcript, including which tools Buddie used.
- **🖥️ Voice-only mode:** A full-screen voice view by default, with a **Show transcript** toggle for the chat and a typing box.
- **📱 Responsive layout** with a slide-out chat drawer on mobile.

---

## 🛠️ Architecture

Each turn follows this cycle:

```
 Browser                                   Flask server                    External
 ───────                                   ────────────                    ────────
 1. Mic → VAD detects end of speech
 2. Speech clip (WAV) ───────────────────► /api/transcribe ───────────────► Groq Whisper
 3. Transcript text  ◄────────────────────  { text }
 4. Text + history + persona ────────────► /api/chat/stream ──────────────► Groq LLM
                                              │  streams tokens           ┌─ tool call? ─► time / weather / search
 5. Tokens appear live  ◄── SSE ─────────────┘  runs tools, continues ◄───┘
 6. Each finished sentence ──────────────► /api/tts ──────────────────────► edge-tts
 7. MP3 audio  ◄───────────────────────────  audio/mpeg
 8. Audio queue plays, waveform animates, VAD resumes when Buddie finishes
```

**Why it is built this way**

- **VAD runs in the browser.** Audio is only uploaded after you finish a sentence, so silence is never sent to the server.
- **SSE over `fetch`.** `EventSource` only supports GET, so the browser reads the event stream from a `fetch` response.
- **Tools run on the server.** The model streams a tool request, the server runs the function, and the result goes back to the model, which then continues its answer. If the model produces a malformed tool call, the server retries without tools.
- **Three small endpoints instead of one big one.** Transcription, chat and speech are separate, which makes each step independently testable and lets speech start before the answer finishes.
- **Browser-side storage.** Sessions live in `localStorage`, which works on serverless hosts where the filesystem does not persist.

### API endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/` | Web interface |
| `GET` | `/api/config` | Available voices and personas |
| `POST` | `/api/transcribe` | Audio file in, `{ text }` out |
| `POST` | `/api/chat/stream` | `{ text, history, persona, tz }` in, SSE stream out (`token`, `tool`, `done`, `error` events) |
| `POST` | `/api/tts` | `{ text, voice }` in, `audio/mpeg` out |

### Project structure

```
Buddie-AI-Voice-Assistant/
├── app.py               # Flask backend: STT, streaming LLM loop, tools, TTS
├── templates/
│   └── index.html       # Page markup
├── public/              # Static files (served from here on Vercel and locally)
│   ├── buddie.js        # VAD, SSE client, audio queue, waveform, sessions, export
│   └── buddie.css       # Styling
├── requirements.txt
├── vercel.json
└── .env                 # Local secrets (never committed)
```

---

## 📦 Quick Start

### Prerequisites

- Python 3.x
- A [Groq API key](https://console.groq.com/keys)
- A modern browser with microphone access (Chrome, Edge or Firefox)

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/Arslan-SoftwareEngineer/Buddie-AI-Voice-Assistant.git
cd Buddie-AI-Voice-Assistant
```

**2. Install dependencies**

```bash
pip install -r requirements.txt
```

**3. Configure your environment**

Create a `.env` file next to `app.py`:

```
GROQ_API_KEY=your_key_here
```

Optional settings:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_MODEL` | `openai/gpt-oss-120b` | Groq chat model. Groq changes its lineup over time, so override this if a model is retired. |
| `FLASK_DEBUG` | off | Set to `1` for Flask debug mode. |

> ⚠️ Never commit your `.env` file. It is listed in `.gitignore`.

**4. Run locally**

```bash
python app.py
```

Open `http://127.0.0.1:5000`, click the mic, and start talking.

---

## 🎯 Usage

- **Talk:** Click the mic once. It glows while Buddie is listening, and replies start when you pause.
- **Interrupt:** While Buddie is thinking or speaking, the mic button becomes a stop button.
- **Type instead:** Click **Show transcript** to reveal the text box.
- **Try a tool:** Ask "What's the weather in Islamabad?", "What time is it in Tokyo?" or "What's the latest news about SpaceX?"
- **Export:** Use **Download transcript (.md)** to save the current chat.

---

## 🏗️ Deployment

The project is configured for [Vercel](https://vercel.com/).

1. Push your changes to GitHub.
2. In **Project Settings → Environment Variables**, add `GROQ_API_KEY` (and optionally `LLM_MODEL`).
3. Redeploy.

**Good to know**

- Microphone access requires HTTPS, which Vercel provides.
- Serverless platforms may buffer streaming responses or enforce function time limits. If tokens arrive all at once or web-search replies time out, run the app on a platform with long-lived processes (Render, Railway, Fly.io) or locally.
- Headphones give the best experience, since Buddie pauses listening while it speaks to avoid hearing itself.

---

## 🧭 Roadmap

- Barge-in: interrupt Buddie by speaking over it
- Optional server-side chat storage (SQLite or a hosted database)
- More tools (calendar, notes, unit conversion)
- Multilingual voices and replies

---

## 🤝 Contributions & License

Contributions are welcome. If you find a bug or have an idea, please open an issue or submit a pull request.