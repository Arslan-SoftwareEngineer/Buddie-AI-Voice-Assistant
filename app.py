import os
import json
import base64
import asyncio
import time
import edge_tts
from flask import Flask, render_template, request, jsonify
from groq import Groq

app = Flask(__name__)
client = Groq()

# ==========================================
# 1. Listening Function (Speech-to-Text)
# ==========================================
def listen_to_audio(file_path):
    with open(file_path, "rb") as file:
        transcription = client.audio.transcriptions.create(
            file=(file_path, file.read()),
            model="whisper-large-v3",
        )
    return transcription.text

# ==========================================
# 2. Response Function (LLM with History)
# ==========================================
def generate_ai_response(user_text, history):
    system_prompt = {
        "role": "system",
        "content": "You are Buddie, a concise, friendly voice assistant. Keep answers conversational, clear, and under 2-3 sentences."
    }
    
    # Merge system prompt, prior context, and current user input
    messages = [system_prompt] + history + [{"role": "user", "content": user_text}]

    chat_completion = client.chat.completions.create(
        messages=messages,
        model="llama-3.3-70b-versatile",
    )
    return chat_completion.choices[0].message.content

# ==========================================
# 3. Speaking Function (Text-to-Speech)
# ==========================================
def speak_text(text):
    filename = f"/tmp/response_{int(time.time() * 1000)}.mp3"
    communicate = edge_tts.Communicate(text, "en-US-AriaNeural")
    asyncio.run(communicate.save(filename))
    
    with open(filename, "rb") as audio_file:
        base64_audio = base64.b64encode(audio_file.read()).decode('utf-8')
        
    os.remove(filename)  # Clean up
    return f"data:audio/mp3;base64,{base64_audio}"
    
# ==========================================
# Flask Routes
# ==========================================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/chat', methods=['POST'])
def chat():
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    # Parse incoming conversation history from FormData
    raw_history = request.form.get("history", "[]")
    try:
        history = json.loads(raw_history)
    except json.JSONDecodeError:
        history = []

    audio_file = request.files['audio']
    file_path = f"/tmp/temp_audio_{int(time.time() * 1000)}.webm"
    audio_file.save(file_path)
    
    try:
        user_text = listen_to_audio(file_path)
        ai_text = generate_ai_response(user_text, history)
        audio_url = speak_text(ai_text)
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)  # Always clean up temp audio

    return jsonify({
        "user_text": user_text,
        "ai_text": ai_text,
        "audio_url": audio_url
    })
    
if __name__ == '__main__':
    app.run(debug=True)