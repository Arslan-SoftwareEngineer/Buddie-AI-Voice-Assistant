# 🎙️ Buddie AI Voice Assistant

**A seamless, hands-free conversational AI experience.**

[![Python](https://img.shields.io/badge/Python-3.x-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-Framework-green.svg)](https://flask.palletsprojects.com/)
[![Groq](https://img.shields.io/badge/AI-Groq-red.svg)](https://groq.com/)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black.svg)](https://vercel.com/)

---

## 🚀 Overview

**Buddie** is an intelligent, responsive, web-based AI voice assistant designed for natural, continuous interaction. It transforms your voice into actionable insights, providing real-time spoken responses powered by industry-leading AI models.

Built for speed and accessibility, this project demonstrates how to bridge high-performance AI inference with a web interface to create a truly hands-free, conversational experience.

---

## 🌟 Key Features

*   **⚡ Lightning-Fast Transcription**: Uses Groq's `whisper-large-v3` to convert your voice into text with industry-leading speed.
*   **🧠 Intelligent Conversation**: Powered by `llama-3.3-70b-versatile` via Groq, providing smart, context-aware, and human-like interaction.
*   **🗣️ Natural Text-to-Speech**: Integrates `edge-tts` to deliver crisp, lifelike vocal responses in seconds.
*   **🔄 Continuous Loop**: Features a seamless auto-trigger mechanism that restarts the listening cycle immediately after the AI finishes speaking.
*   **☁️ Serverless Optimized**: Expertly engineered for deployment on Vercel using memory-efficient Base64 audio handling.

---

## 🛠️ Architecture

The assistant follows an efficient round-trip cycle:

1.  **Capture**: Your browser records audio via the `MediaRecorder` API.
2.  **Transcribe**: The audio is sent to Groq’s Whisper model for rapid text conversion.
3.  **Reason**: The text is processed by LLaMA 3 for an intelligent response.
4.  **Synthesize**: The response is converted to audio via `edge-tts`.
5.  **Deliver**: The voice data is encoded as Base64 and played directly in your browser.

---

## 📦 Quick Start

### Prerequisites
*   Python 3.x installed
*   A [Groq API Key](https://console.groq.com/)

### Installation

#### 1. Clone the repository:
```bash
git clone [https://github.com/Arslan-SoftwareEngineer/Buddie-AI-Voice-Assistant.git](https://github.com/Arslan-SoftwareEngineer/Buddie-AI-Voice-Assistant.git)
cd Buddie-AI-Voice-Assistant
```

#### 4. Install Dependencies:
``` bash
pip install -r requirements.txt
```

#### 5. Configure Environment:
Set your Groq API key:
*   Locally: Create a `.env` file with `GROQ_API_KEY=your_key_here`.
*   Vercel: Add `GROQ_API_KEY` in your __Project Settings > Environment Variables__.

#### 6. Run Locally:
```bash
python app.py
```

---

## 🏗️ Deployment
This project is configured for seamless deployment on Vercel.

*   Ensure your `requirements.txt` is updated.
*   Push your changes to GitHub, and Vercel (or any preferred deployment platform).

---

## 🤝 Contributions & License
Contributions are welcome! If you find a bug or have an idea for an enhancement, please open an issue or submit a pull request.
