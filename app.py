import os
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
# 2. Response Function (LLM)
# ==========================================
def generate_ai_response(user_text):
    chat_completion = client.chat.completions.create(
        messages=[
            {"role": "system", "content": "You are a helpful, concise AI voice assistant."},
            {"role": "user", "content": user_text}
        ],
        model="llama-3.3-70b-versatile",
    )
    return chat_completion.choices[0].message.content

# ==========================================
# 3. Speaking Function (Text-to-Speech)
# ==========================================
def speak_text(text):
    filename = f"/tmp/response_{int(time.time())}.mp3"
    communicate = edge_tts.Communicate(text, "en-US-AriaNeural")
    asyncio.run(communicate.save(filename))
    
    with open(filename, "rb") as audio_file:
        base64_audio = base64.b64encode(audio_file.read()).decode('utf-8')
        
    os.remove(filename) # Clean up
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

    audio_file = request.files['audio']
    file_path = f"/tmp/temp_audio_{int(time.time())}.webm"
    audio_file.save(file_path)
    
    user_text = listen_to_audio(file_path)
    ai_text = generate_ai_response(user_text)
    audio_url = speak_text(ai_text) 

    os.remove(file_path) # Clean up

    return jsonify({
        "user_text": user_text,
        "ai_text": ai_text,
        "audio_url": audio_url
    })
    
if __name__ == '__main__':
    app.run(debug=True)
