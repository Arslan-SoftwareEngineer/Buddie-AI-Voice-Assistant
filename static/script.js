(() => {
  "use strict";

  // ---------- Constants ----------
  const VAD_BASE = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/";
  const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
  const SESSIONS_KEY = "buddie.sessions.v1";
  const PREFS_KEY = "buddie.prefs.v1";
  const TOOL_LABELS = {
    get_current_datetime: "Checked the clock",
    get_weather: "Checked live weather",
    web_search: "Searched the web",
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    app: $("app"), stage: $("stage"), status: $("status"), mic: $("mic"), log: $("log"),
    persona: $("persona"), voice: $("voice"), list: $("sessionList"),
    newChat: $("newChat"), exportBtn: $("export"), form: $("textForm"), input: $("textInput"),
    toggle: $("toggleSessions"), canvas: $("wave"),
    toggleTranscript: $("toggleTranscript"), main: document.querySelector("main"),
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ---------- Persistence (localStorage) ----------
  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  }

  let sessions = readJSON(SESSIONS_KEY, []);
  const prefs = Object.assign({ persona: "friendly", voice: "en-US-AriaNeural", transcript: false }, readJSON(PREFS_KEY, {}));
  let currentId = null;

  const saveSessions = () => writeJSON(SESSIONS_KEY, sessions);
  const savePrefs = () => writeJSON(PREFS_KEY, prefs);
  const current = () => sessions.find((s) => s.id === currentId);

  function newSession() {
    const s = { id: crypto.randomUUID(), title: "New chat", created: Date.now(), updated: Date.now(), messages: [] };
    sessions.unshift(s);
    currentId = s.id;
    saveSessions();
    return s;
  }

  // ---------- UI state ----------
  let listening = false;   // user has ambient mode switched on
  let busy = false;        // a turn is being processed or spoken
  let abortCtrl = null;
  let speaker = null;

  function setState(state, text) {
    els.stage.dataset.state = state;
    if (text) els.status.textContent = text;
    const working = state === "thinking" || state === "speaking";
    const label = working ? "Interrupt" : listening ? "Stop listening" : "Start listening";
    els.mic.dataset.mode = working ? "busy" : listening ? "listening" : "idle";
    els.mic.setAttribute("aria-label", label);
    els.mic.title = label;
  }

  // ---------- Rendering ----------
  function addBubble(role, text) {
    const empty = els.log.querySelector(".empty");
    if (empty) empty.remove();
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    els.log.appendChild(div);
    els.log.scrollTop = els.log.scrollHeight;
    return div;
  }

  function renderLog() {
    els.log.innerHTML = "";
    const s = current();
    if (!s || s.messages.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Nothing here yet. Start listening and say hello, or type below.";
      els.log.appendChild(p);
      return;
    }
    for (const m of s.messages) {
      const b = addBubble(m.role, m.content);
      if (m.tools && m.tools.length) setToolNote(b, m.tools);
    }
  }

  function setToolNote(bubble, tools) {
    let note = bubble.querySelector(".tool");
    if (!note) {
      note = document.createElement("span");
      note.className = "tool";
      bubble.prepend(note);
    }
    note.textContent = [...new Set(tools)].map((t) => TOOL_LABELS[t] || t).join(", ");
  }

  function renderSessions() {
    els.list.innerHTML = "";
    const sorted = [...sessions].sort((a, b) => b.updated - a.updated);
    for (const s of sorted) {
      const li = document.createElement("li");
      if (s.id === currentId) li.className = "active";
      const open = document.createElement("button");
      open.className = "open";
      open.type = "button";
      open.textContent = s.title;
      open.addEventListener("click", () => switchSession(s.id));
      const del = document.createElement("button");
      del.className = "del";
      del.type = "button";
      del.textContent = "Delete";
      del.setAttribute("aria-label", `Delete chat: ${s.title}`);
      del.addEventListener("click", () => deleteSession(s.id));
      li.append(open, del);
      els.list.appendChild(li);
    }
  }

  function switchSession(id) {
    interrupt(false);
    currentId = id;
    renderSessions();
    renderLog();
    els.app.classList.remove("drawer-open");
  }

  function deleteSession(id) {
    sessions = sessions.filter((s) => s.id !== id);
    if (currentId === id) {
      interrupt(false);
      currentId = sessions[0]?.id ?? null;
      if (!currentId) newSession();
    }
    saveSessions();
    renderSessions();
    renderLog();
  }

  // ---------- Audio graph + waveform ----------
  let audioCtx = null, analyser = null, freq = null, ttsEl = null;
  let micStream = null, micSource = null;

  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    freq = new Uint8Array(analyser.frequencyBinCount);
    ttsEl = new Audio();
    const src = audioCtx.createMediaElementSource(ttsEl); // can only be created once per element
    src.connect(analyser);
    src.connect(audioCtx.destination);
  }

  async function attachMic() {
    if (micStream) return;
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(analyser); // analyser is not wired to the speakers, so no feedback
  }

  function detachMic() {
    if (micSource) micSource.disconnect();
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micSource = micStream = null;
  }

  const g = els.canvas.getContext("2d");
  function resizeCanvas() {
    const r = els.canvas.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    els.canvas.width = Math.round(r.width * d);
    els.canvas.height = Math.round(r.height * d);
    g.setTransform(d, 0, 0, d, 0, 0);
  }
  new ResizeObserver(resizeCanvas).observe(els.canvas); // follows layout changes (transcript toggle, window resize)

  function draw() {
    requestAnimationFrame(draw);
    const w = els.canvas.clientWidth, h = els.canvas.clientHeight;
    g.clearRect(0, 0, w, h);
    if (analyser) analyser.getByteFrequencyData(freq);

    const state = els.stage.dataset.state;
    const base = state === "speaking" ? "154,140,255" : "61,219,192";
    const half = 28;                       // bars per side of the centre line
    const gap = 4;
    const barW = Math.max(3, (w - gap * (half * 2)) / (half * 2));
    const mid = h / 2;

    g.shadowBlur = 14;
    g.shadowColor = `rgba(${base},0.9)`;
    for (let i = 0; i < half; i++) {
      // Speech lives in the low bins, so sample the first ~60% of the spectrum.
      const bin = 1 + Math.floor((i / half) * (freq ? freq.length * 0.6 : 1));
      const v = freq ? freq[bin] / 255 : 0;
      const bh = Math.max(4, v * h * 0.9);
      const alpha = 0.35 + v * 0.65;
      g.fillStyle = `rgba(${base},${alpha})`;
      for (const dir of [-1, 1]) {
        const x = w / 2 + dir * (i * (barW + gap)) - barW / 2;
        if (g.roundRect) { g.beginPath(); g.roundRect(x, mid - bh / 2, barW, bh, barW / 2); g.fill(); }
        else g.fillRect(x, mid - bh / 2, barW, bh);
      }
    }
    g.shadowBlur = 0;
  }

  // ---------- Text-to-speech queue (sentence by sentence) ----------
  function playBlob(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const finish = () => {
        ttsEl.onended = ttsEl.onerror = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      ttsEl.onended = finish;
      ttsEl.onerror = finish;
      ttsEl.src = url;
      setState("speaking", "Buddie is speaking");
      ttsEl.play().catch(finish);
    });
  }

  class Speaker {
    constructor(voice) {
      this.voice = voice;
      this.buf = "";
      this.queue = [];
      this.playing = null;
      this.stopped = false;
    }
    push(token) {
      this.buf += token;
      this.drain(false);
    }
    flush() {
      this.drain(true);
    }
    drain(final) {
      // Cut on sentence ends followed by whitespace; short fragments wait for the next one.
      const re = /([.!?]+["')\]]*)\s+/g;
      let last = 0, m;
      while ((m = re.exec(this.buf))) {
        const end = m.index + m[0].length;
        const piece = this.buf.slice(last, end).trim();
        if (piece.length >= 24) { this.enqueue(piece); last = end; }
      }
      this.buf = this.buf.slice(last);
      if (final && this.buf.trim()) { this.enqueue(this.buf.trim()); this.buf = ""; }
    }
    enqueue(text) {
      const clean = text.replace(/[*_`#>~]/g, "").trim();
      if (!clean || this.stopped) return;
      // Fetch right away so audio is ready by the time the previous sentence ends.
      const p = fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: this.voice }),
      }).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
      this.queue.push(p);
      this.pump();
    }
    pump() {
      if (this.playing) return;
      this.playing = (async () => {
        while (this.queue.length && !this.stopped) {
          const blob = await this.queue.shift();
          if (blob && !this.stopped) await playBlob(blob);
        }
        this.playing = null;
      })();
    }
    async finished() {
      while (this.playing) await this.playing;
    }
    stop() {
      this.stopped = true;
      this.queue = [];
      if (ttsEl) {
        const done = ttsEl.onended;
        ttsEl.pause();
        if (done) done();
      }
    }
  }

  // ---------- One conversation turn ----------
  async function runTurn(userText) {
    const s = current() || newSession();
    const history = s.messages
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-20);

    s.messages.push({ role: "user", content: userText, ts: Date.now() });
    if (s.title === "New chat") s.title = userText.slice(0, 40);
    addBubble("user", userText);

    const reply = { role: "assistant", content: "", ts: Date.now(), tools: [] };
    s.messages.push(reply);
    const bubble = addBubble("assistant", "…");
    s.updated = Date.now();
    saveSessions();
    renderSessions();

    busy = true;
    setState("thinking", "Thinking…");
    ensureAudio();
    await audioCtx.resume();

    abortCtrl = new AbortController();
    speaker = new Speaker(prefs.voice);
    const mySpeaker = speaker;

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userText, history, persona: prefs.persona, tz }),
        signal: abortCtrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Server returned ${res.status}`);

      // EventSource only supports GET, so read the SSE stream from fetch directly.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (!frame.startsWith("data:")) continue;
          const evt = JSON.parse(frame.slice(5));
          if (evt.type === "token") {
            reply.content += evt.text;
            bubble.textContent = reply.content;
            if (reply.tools.length) setToolNote(bubble, reply.tools);
            els.log.scrollTop = els.log.scrollHeight;
            mySpeaker.push(evt.text);
          } else if (evt.type === "tool") {
            reply.tools.push(evt.name);
            setToolNote(bubble, reply.tools);
            setState("thinking", `${TOOL_LABELS[evt.name] || "Using a tool"}…`);
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        }
      }
      mySpeaker.flush();
      await mySpeaker.finished();
    } catch (err) {
      if (err.name !== "AbortError") {
        bubble.classList.add("error");
        if (!reply.content) bubble.textContent = `Buddie hit an error: ${err.message}`;
        setState("error", `Request failed: ${err.message}`);
        console.error(err);
      }
    } finally {
      if (!reply.content) s.messages.splice(s.messages.indexOf(reply), 1);
      s.updated = Date.now();
      saveSessions();
      renderSessions();
      busy = false;
      abortCtrl = null;
      if (speaker === mySpeaker) speaker = null;
      afterTurn();
    }
  }

  function afterTurn() {
    if (listening) {
      resumeVad();
    } else if (els.stage.dataset.state !== "error") {
      setState("idle", "Press start, then just talk. Buddie replies when you pause.");
    }
  }

  function interrupt(resume = true) {
    if (abortCtrl) abortCtrl.abort();
    if (speaker) speaker.stop();
    if (!resume) busy = false;
  }

  // ---------- Voice activity detection ----------
  let micVad = null;

  function encodeWav(float32, sampleRate = 16000) {
    const buffer = new ArrayBuffer(44 + float32.length * 2);
    const v = new DataView(buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + float32.length * 2, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, float32.length * 2, true);
    for (let i = 0; i < float32.length; i++) {
      const x = Math.max(-1, Math.min(1, float32[i]));
      v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  async function handleUtterance(audio) {
    busy = true;
    setState("thinking", "Transcribing…");
    try {
      const form = new FormData();
      form.append("audio", encodeWav(audio), "speech.wav");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed");
      const text = (data.text || "").trim();
      if (!text) { busy = false; afterTurn(); return; }
      await runTurn(text);
    } catch (err) {
      console.error(err);
      busy = false;
      setState("error", "Could not transcribe that. Try again.");
      if (listening) { await sleep(1200); resumeVad(); }
    }
  }

  async function startVad() {
    if (!window.vad || !window.vad.MicVAD) {
      setState("error", "Voice detection failed to load. Check your connection and reload.");
      return false;
    }
    if (!micVad) {
      setState("idle", "Loading voice detection…");
      micVad = await window.vad.MicVAD.new({
        baseAssetPath: VAD_BASE,
        onnxWASMBasePath: ORT_BASE,
        redemptionMs: 900,   // how long a pause ends your turn
        minSpeechMs: 400,    // ignore clicks and coughs
        onSpeechStart: () => { if (!busy) setState("hearing", "Hearing you…"); },
        onVADMisfire: () => { if (!busy) setState("listening", "Listening…"); },
        onSpeechEnd: (audio) => {
          if (busy) return;
          micVad.pause();       // stop listening while Buddie works and speaks
          handleUtterance(audio);
        },
      });
    }
    micVad.start();
    setState("listening", "Listening…");
    return true;
  }

  function resumeVad() {
    if (micVad && listening) {
      micVad.start();
      setState("listening", "Listening…");
    }
  }

  async function toggleListening() {
    ensureAudio();
    await audioCtx.resume();

    if (busy) { interrupt(); return; }   // button reads "Interrupt" while Buddie is working

    if (listening) {
      listening = false;
      if (micVad) micVad.pause();
      detachMic();
      setState("idle", "Stopped. Press start whenever you want to talk.");
      return;
    }

    try {
      await attachMic();
    } catch {
      setState("error", "Microphone blocked. Allow mic access in your browser and try again.");
      return;
    }
    listening = true;
    const ok = await startVad();
    if (!ok) { listening = false; detachMic(); }
  }

  // ---------- Export ----------
  function exportMarkdown() {
    const s = current();
    if (!s || s.messages.length === 0) {
      setState(els.stage.dataset.state, "Nothing to export yet.");
      return;
    }
    const personaLabel = els.persona.selectedOptions[0]?.textContent || prefs.persona;
    const lines = [
      `# ${s.title}`,
      "",
      `_Exported ${new Date().toLocaleString()} · Persona: ${personaLabel}_`,
      "",
    ];
    for (const m of s.messages) {
      const who = m.role === "user" ? "You" : "Buddie";
      lines.push(`**${who}** (${new Date(m.ts).toLocaleTimeString()}):`, "", m.content);
      if (m.tools && m.tools.length) {
        lines.push("", `_Tools used: ${[...new Set(m.tools)].join(", ")}_`);
      }
      lines.push("");
    }
    const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chat";
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `buddie-${slug}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Wiring ----------
  async function loadConfig() {
    let cfg;
    try {
      cfg = await (await fetch("/api/config")).json();
    } catch {
      cfg = {
        voices: [{ id: prefs.voice, label: "Default voice" }],
        personas: [{ id: prefs.persona, label: "Buddie" }],
      };
    }
    const fill = (select, items, selected) => {
      select.innerHTML = "";
      for (const it of items) {
        const o = document.createElement("option");
        o.value = it.id;
        o.textContent = it.label;
        select.appendChild(o);
      }
      select.value = items.some((i) => i.id === selected) ? selected : items[0].id;
    };
    fill(els.persona, cfg.personas, prefs.persona);
    fill(els.voice, cfg.voices, prefs.voice);
    prefs.persona = els.persona.value;
    prefs.voice = els.voice.value;
  }

  els.persona.addEventListener("change", () => { prefs.persona = els.persona.value; savePrefs(); });
  els.voice.addEventListener("change", () => { prefs.voice = els.voice.value; savePrefs(); });
  els.mic.addEventListener("click", toggleListening);
  els.exportBtn.addEventListener("click", exportMarkdown);
  els.newChat.addEventListener("click", () => {
    interrupt(false);
    newSession();
    renderSessions();
    renderLog();
    els.app.classList.remove("drawer-open");
  });
  if (els.toggle) els.toggle.addEventListener("click", () => {
    const open = els.app.classList.toggle("drawer-open");
    els.toggle.setAttribute("aria-expanded", String(open));
  });
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || busy) return;
    els.input.value = "";
    if (micVad && listening) micVad.pause();
    runTurn(text);
  });

  function applyTranscript() {
    const show = !!prefs.transcript;
    els.main.classList.toggle("voice-only", !show);
    if (els.toggleTranscript) {
      els.toggleTranscript.textContent = show ? "Hide transcript" : "Show transcript";
      els.toggleTranscript.setAttribute("aria-pressed", String(show));
    }
    if (show) els.log.scrollTop = els.log.scrollHeight;
  }
  if (els.toggleTranscript) els.toggleTranscript.addEventListener("click", () => {
    prefs.transcript = !prefs.transcript;
    savePrefs();
    applyTranscript();
  });

  (async function init() {
    // Draw the UI first so one failing step can never leave the page blank.
    if (!sessions.length) newSession();
    currentId = sessions.sort((a, b) => b.updated - a.updated)[0].id;
    renderSessions();
    renderLog();
    applyTranscript();
    resizeCanvas();
    draw();
    try { await loadConfig(); } catch (err) { console.error("loadConfig failed", err); }
  })();
})();