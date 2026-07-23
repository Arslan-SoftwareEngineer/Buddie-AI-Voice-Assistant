document.addEventListener("DOMContentLoaded", () => {
    let mediaRecorder;
    let audioChunks = [];

    const recordBtn = document.getElementById('recordBtn');
    const stopBtn = document.getElementById('stopBtn');
    const mainStatus = document.getElementById('main-status');
    const chatLog = document.getElementById('chatLog');
    const chatViewport = document.getElementById('chatViewport');
    const statusDot = document.querySelector('.status-dot');
    const player = document.getElementById('audioPlayer');

    function appendMessage(sender, text) {
        const messageRow = document.createElement('div');
        messageRow.classList.add('chat-message', sender);
        
        const bubble = document.createElement('div');
        bubble.classList.add('message-bubble');
        bubble.textContent = text;
        
        messageRow.appendChild(bubble);
        chatLog.appendChild(messageRow);
        chatViewport.scrollTop = chatViewport.scrollHeight;
    }

    function setStatus(state, message) {
        // Added safety checks to prevent 'null' crashes
        if (statusDot) {
            statusDot.className = 'status-dot';
            statusDot.classList.add(state);
        }
        if (mainStatus) {
            mainStatus.textContent = message;
        }
    }

    function resetUI() {
        if (recordBtn) {
            recordBtn.className = "btn-mic";
            recordBtn.disabled = false;
        }
        if (stopBtn) {
            stopBtn.disabled = true;
        }
        setStatus('online', 'Ready to chat.');
    }

    if (recordBtn) {
        recordBtn.onclick = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                
                mediaRecorder.ondataavailable = event => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    audioChunks = [];
                    
                    const formData = new FormData();
                    formData.append('audio', audioBlob, 'recording.webm');
                    
                    try {
                        const response = await fetch('/api/chat', {
                            method: 'POST',
                            body: formData
                        });
                        
                        // THIS WAS THE MISSING LINE CAUSING THE CRASH!
                        const data = await response.json();
                        
                        appendMessage('user', data.user_text);
                        appendMessage('ai', data.ai_text);
                        
                        setStatus('online', 'Speaking...');

                        // HTML5 Audio Player playback
                        if (player) {
                            player.src = data.audio_url + "?t=" + new Date().getTime();
                            player.load();
                            
                            player.play().catch(e => {
                                console.error("Browser blocked playback:", e);
                                resetUI();
                            });

                            player.onended = () => {
                                resetUI();
                                const userInput = data.user_text.toLowerCase();
                                if (userInput.includes("exit") || userInput.includes("stop")) {
                                    setStatus('online', 'Conversation ended.');
                                } else {
                                    recordBtn.click(); // Auto-restart
                                }
                            };
                        } else {
                            console.error("Audio player element <audio id='audioPlayer'> is missing in HTML!");
                            resetUI();
                        }

                    } catch (error) {
                        console.error("Fetch or parsing error:", error);
                        if (mainStatus) mainStatus.textContent = "Error connecting to server.";
                        resetUI();
                    }
                };

                mediaRecorder.start();
                recordBtn.className = "btn-mic recording";
                recordBtn.disabled = true;
                if (stopBtn) stopBtn.disabled = false;
                setStatus('recording', 'Listening...');

            } catch (err) {
                console.error("Microphone error:", err);
                if (mainStatus) mainStatus.textContent = "Microphone access denied.";
                resetUI();
            }
        };
    }

    if (stopBtn) {
        stopBtn.onclick = () => {
            if (mediaRecorder && mediaRecorder.state === "recording") {
                mediaRecorder.stop();
                recordBtn.className = "btn-mic thinking";
                stopBtn.disabled = true;
                setStatus('thinking', 'Processing Audio...');
            }
        };
    }

    resetUI();
});