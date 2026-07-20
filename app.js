
/* ================================================================
   SECURITY: the API key lives ONLY on the server now.
   ================================================================
   This file no longer contains any key, obfuscated or not — there
   is nothing here for an attacker to find. All requests go to your
   own "/api/chat" serverless function (see proxy/api/chat.js),
   which attaches the real key server-side from an environment
   variable. Deploy this whole folder + proxy/ to Vercel, set
   GROQ_API_KEY (or GEMINI_API_KEY / ANTHROPIC_API_KEY) in Vercel's
   Environment Variables, and you're done — see README below.
   ================================================================ */

/* ================= CONFIG ================= */
const CLAUDE_MODEL = "claude-sonnet-4-6";
const GEMINI_MODEL = "gemini-2.5-flash";
const GROQ_MODEL = "llama-3.3-70b-versatile";

/* -------- System prompt: COACH MODE (full Lumina) -------- */
const COACH_PROMPT = `
## 1. Core Persona & Tone
- Role: You are "Lumina", an expert IELTS tutor and encouraging coach.
- Tone: Professional, encouraging, highly constructive, and engaging.
- Target Audience: IELTS aspirants (Academic and General Training) ranging from beginner to advanced English levels.
- Primary Mandate: Help users improve their English grammar through natural conversation, answer IELTS-related queries (with a heavy focus on the Writing modules), and manage a gamified progression system to keep them motivated.

## 2. Dynamic Point System (Gamification)
Track and award points dynamically based on user behavior. Every response you generate MUST conclude with a "Scoreboard Update" block.

Earning Points Matrix:
- Daily Check-in / Starting a chat: +10 points
- Asking an IELTS-related query: +15 points
- Submitting an essay or paragraph for review: +50 points
- Successfully correcting a grammar mistake you pointed out: +20 points
- Maintaining a "Streak" (mention this to encourage return visits): +5 points per day

Format for Scoreboard Update (append to the END of every message, exactly this structure):
---
📊 **Your Scoreboard:**
*   **Points Earned This Turn:** +[X] ([Reason])
*   **Current Streak:** [X] Days
*   **Next Milestone:** [X] points remaining until you unlock [Reward/Rank, e.g., "IELTS Warrior" or "Band 9 Master"]

## 3. Interaction Pillars & Behavior

### Pillar A: General Chat & Proactive Grammar Correction
- Engage in casual conversation to build user confidence.
- Crucial Rule: If the user makes a grammatical, spelling, or punctuation error in any message, gently correct it.
- Correction Format: Use a dedicated "🔧 Quick Polish:" section at the top of your response. Show what they said, the corrected version, and briefly explain why (subject-verb agreement, tenses, prepositions, etc.).

### Pillar B: IELTS Strategy & Queries
- Answer questions on test format, scoring criteria (Band Descriptors), time management, and test-day strategies.
- Keep answers actionable, concise, and structured with bullet points.

### Pillar C: Writing Evaluation (Main Focus)
When the user submits an essay, paragraph, or sentence for IELTS Writing Task 1 or Task 2:
1. Analyze based on the 4 official criteria: Task Achievement/Response, Coherence & Cohesion, Lexical Resource, and Grammatical Range & Accuracy.
2. Provide an estimated Band Score (e.g., Band 6.5).
3. Feedback structure:
   - What Went Well: highlight good vocabulary or strong arguments.
   - Where to Improve: specific alternatives for weak phrasing or repetitive vocabulary.
   - Upgraded Sample: rewrite a short snippet of their text at a Band 8+ level.

## 4. Operational Constraints & Edge Cases
- Language Level Adaptation: Match vocabulary complexity to the user's estimated level.
- Strict Guardrails: If the user asks about topics completely unrelated to English learning or the IELTS exam, politely pivot back to their preparation goals.
- Maintain the Points: Always calculate and display the points every turn. If the user asks for their total score, calculate it from conversation history.
`.trim();

/* -------- System prompt: CASUAL MODE (normal assistant) -------- */
const CASUAL_PROMPT = `
You are "Lumina", a friendly, capable general-purpose AI assistant.

Casual mode rules:
- Behave like a normal helpful AI assistant. Answer any topic the user brings up — it does NOT need to relate to IELTS or English learning.
- Do NOT correct the user's grammar, spelling, or punctuation. Never add a "Quick Polish" section. Ignore their language mistakes completely and just respond to what they mean.
- Do NOT award points, mention streaks, or include any "Scoreboard Update" block.
- Keep a warm, conversational, natural tone. Be concise unless depth is asked for.
- If the user explicitly asks for IELTS help or writing feedback while in this mode, help them normally, but still without points or unsolicited corrections.
`.trim();

const WELCOME = `Hello there! 👋 I'm **Lumina**, your personal IELTS Coach. I'm here to answer your prep questions, grade your writing essays, and help polish your grammar through everyday chat.

To make things fun, you'll earn points for practicing, asking questions, and fixing mistakes. Let's get you that Band 8+! 🚀

To kick things off: **Are you preparing for the Academic or General Training exam, and what is your target Band Score?**

---
📊 **Your Scoreboard:**
*   **Points Earned This Turn:** +10 (First Session Check-in)
*   **Current Streak:** 1 Day
*   **Next Milestone:** 40 points until you unlock 'IELTS Novice' Rank!`;

const SUGGESTIONS = {
  coach:  ["How is Writing Task 2 scored?", "Give me a Task 2 question to practice", "Tips to reach Band 7 in writing", "Grade this paragraph: ..."],
  casual: ["Help me plan my week", "Explain something interesting", "Draft an email for me", "Let's just chat"]
};

/* ================= SAFE STORAGE =================
   localStorage is enabled for your deployed site.
   (It's blocked inside the Claude.ai preview, so every call is
   wrapped in try/catch and the app falls back to memory-only.) */
const store = {
  get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
};

/* ================= STATE ================= */
let messages = [];
let totalPoints = parseInt(store.get("lumina_points") || "0", 10) || 0;
let streak = parseInt(store.get("lumina_streak") || "1", 10) || 1;
// no apiKey variable needed — the proxy attaches auth server-side
let mode = store.get("lumina_mode") || "coach";   // "coach" | "casual"
let busy = false;

/* ================= DOM ================= */
const thread   = document.getElementById("thread");
const chatArea = document.getElementById("chatArea");
const input    = document.getElementById("input");
const sendBtn  = document.getElementById("sendBtn");
const chip     = document.getElementById("pointsChip");
const totalEl  = document.getElementById("totalPoints");
const streakEl = document.getElementById("streakVal");
const banner   = document.getElementById("modeBanner");
const sugBox   = document.getElementById("suggestions");
const btnCoach = document.getElementById("modeCoach");
const btnCasual= document.getElementById("modeCasual");
const micBtn     = document.getElementById("micBtn");
const speakBtn   = document.getElementById("speakBtn");
const attachBtn  = document.getElementById("attachBtn");
const fileInput  = document.getElementById("fileInput");
const attachChip = document.getElementById("attachChip");
const attachName = document.getElementById("attachName");
const attachClear= document.getElementById("attachClear");

/* ================= MODE ================= */
function applyMode(){
  const coach = mode === "coach";
  btnCoach.classList.toggle("active", coach);
  btnCasual.classList.toggle("active", !coach);
  btnCoach.setAttribute("aria-selected", coach);
  btnCasual.setAttribute("aria-selected", !coach);
  chip.classList.toggle("hidden-chip", !coach);
  banner.innerHTML = coach
    ? "<b>Coach mode:</b> grammar corrections, band-score grading &amp; points are ON."
    : "<b>Casual mode:</b> just a normal chat — no corrections, no points. Switch back to 🎓 Coach anytime.";
  document.getElementById("hintBar").textContent = coach
    ? "Lumina estimates band scores for practice — official scores may differ. Enter ↵ to send, Shift+Enter for a new line."
    : "Casual mode — talk about anything. Enter ↵ to send, Shift+Enter for a new line.";
  input.placeholder = coach
    ? "Ask about IELTS, or paste your Task 1 / Task 2 writing here…"
    : "Ask me anything…";
  renderSuggestions();
}
function setMode(m){
  if(mode === m) return;
  mode = m;
  store.set("lumina_mode", m);
  applyMode();
  addSystemNote(m === "coach"
    ? "🎓 Switched to <b>Coach mode</b> — corrections and points are back on."
    : "💬 Switched to <b>Casual mode</b> — I'll chat normally, no corrections or points.");
}
btnCoach.onclick  = () => setMode("coach");
btnCasual.onclick = () => setMode("casual");

function addSystemNote(html){
  const note = document.createElement("div");
  note.style.cssText = "text-align:center;font-size:12px;color:var(--text-2);padding:2px 0;animation:rise .3s ease both";
  note.innerHTML = html;
  thread.appendChild(note);
  chatArea.scrollTop = chatArea.scrollHeight;
}

/* ================= SUGGESTION CHIPS ================= */
function renderSuggestions(){
  sugBox.innerHTML = "";
  SUGGESTIONS[mode].forEach(text => {
    const b = document.createElement("button");
    b.textContent = text;
    b.onclick = () => { input.value = text; input.focus(); autoGrow(); };
    sugBox.appendChild(b);
  });
}

/* Settings UI removed by request: the API key now comes only from the
   hardcoded (lightly obfuscated) constant at the top of this file — there
   is no in-page way for a visitor to view, set, or change it. */

/* ================= VOICE: LIVE TRANSCRIBE (speech → text) =================
   Uses the browser's built-in Web Speech API. Nothing is uploaded to any
   server for this — the transcription happens locally in the browser
   engine, and only the resulting text is ever sent (as a normal chat
   message) once you press Send. */
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let listening = false;
let baseTextBeforeListening = "";

function initRecognizer(){
  if(!SpeechRecognitionAPI || recognizer) return;
  recognizer = new SpeechRecognitionAPI();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.lang = "en-US";

  recognizer.onresult = (e) => {
    let finalChunk = "", interimChunk = "";
    for(let i = e.resultIndex; i < e.results.length; i++){
      const r = e.results[i];
      if(r.isFinal) finalChunk += r[0].transcript;
      else interimChunk += r[0].transcript;
    }
    if(finalChunk){
      baseTextBeforeListening = (baseTextBeforeListening + " " + finalChunk).trim();
    }
    input.value = (baseTextBeforeListening + " " + interimChunk).trim();
    autoGrow();
  };
  recognizer.onerror = (e) => {
    if(e.error === "not-allowed" || e.error === "service-not-allowed"){
      addSystemNote("🎤 Microphone access was blocked — allow it in your browser's site settings to use live transcription.");
    }
    stopListening();
  };
  recognizer.onend = () => {
    // Auto-restart if the user hasn't explicitly stopped (some browsers
    // end the session after a pause in speech).
    if(listening){ try{ recognizer.start(); }catch(e){} }
  };
}

function startListening(){
  if(!SpeechRecognitionAPI){
    addSystemNote("🎤 Live transcription isn't supported in this browser — try Chrome, Edge, or Safari.");
    return;
  }
  initRecognizer();
  stopSpeaking(); // avoid the mic picking up Lumina's own voice
  baseTextBeforeListening = input.value;
  listening = true;
  micBtn.classList.add("listening");
  micBtn.setAttribute("aria-label", "Stop live transcription");
  try{ recognizer.start(); }catch(e){}
}
function stopListening(){
  listening = false;
  micBtn.classList.remove("listening");
  micBtn.setAttribute("aria-label", "Start live transcription");
  if(recognizer){ try{ recognizer.stop(); }catch(e){} }
}
function toggleListening(){ listening ? stopListening() : startListening(); }

if(!SpeechRecognitionAPI){ micBtn.title = "Live transcription isn't supported in this browser"; }
micBtn.onclick = toggleListening;

/* ================= VOICE: SPEAK REPLIES (text → speech) ================= */
let speakEnabled = store.get("lumina_speak") === "1";
const synth = window.speechSynthesis;

function refreshSpeakBtn(){
  speakBtn.classList.toggle("active", speakEnabled);
  speakBtn.textContent = speakEnabled ? "🔊 Speak: On" : "🔈 Speak: Off";
  speakBtn.setAttribute("aria-pressed", String(speakEnabled));
}
function stopSpeaking(){ if(synth){ synth.cancel(); } }
function speakText(rawText){
  if(!speakEnabled || !synth) return;
  // Strip markdown/emoji clutter so the read-aloud version sounds natural.
  const clean = rawText
    .replace(/📊[\s\S]*$/,"")            // drop the scoreboard block
    .replace(/[*_#>`]/g,"")
    .replace(/🔧\s*Quick Polish:?/gi,"Quick polish. ")
    .replace(/\s+/g," ")
    .trim();
  if(!clean) return;
  stopSpeaking();
  // Pause live transcription while Lumina talks, to prevent the mic
  // from hearing (and transcribing) her own voice.
  const wasListening = listening;
  if(wasListening) stopListening();
  const utter = new SpeechSynthesisUtterance(clean);
  utter.rate = 1;
  utter.pitch = 1;
  if(wasListening){
    utter.onend = () => startListening();
  }
  synth.speak(utter);
}
speakBtn.onclick = () => {
  speakEnabled = !speakEnabled;
  store.set("lumina_speak", speakEnabled ? "1" : "0");
  refreshSpeakBtn();
  if(!speakEnabled) stopSpeaking();
};
if(!synth){ speakBtn.disabled = true; speakBtn.title = "Speech playback isn't supported in this browser"; }

/* ================= NOTES UPLOAD ================= =========================
   Lets you attach a plain-text note (.txt/.md/.csv) so Lumina can read it
   as context. Files are read locally with FileReader.readAsText — never
   uploaded anywhere, never parsed as HTML/executed, and never auto-sent:
   the content lands in the composer for you to review before pressing Send. */
let attachedNote = null; // { name, content }

attachBtn.onclick = () => fileInput.click();
fileInput.onchange = () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if(!file) return;
  const okType = /\.(txt|md|markdown|csv)$/i.test(file.name);
  if(!okType){
    addSystemNote("📎 Only plain-text notes are supported here — try a .txt, .md, or .csv file.");
    return;
  }
  if(file.size > 300000){
    addSystemNote("📎 That file's a bit large for a chat note (300KB max) — try a shorter excerpt.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    attachedNote = { name: file.name, content: String(reader.result || "") };
    attachName.textContent = file.name;
    attachChip.classList.add("show");
    const prefix = input.value.trim() ? input.value.trim() + "\n\n" : "";
    input.value = prefix + `Here are my notes from "${file.name}":\n\n${attachedNote.content}`.slice(0, 6000);
    autoGrow();
    input.focus();
  };
  reader.onerror = () => addSystemNote("📎 Couldn't read that file — please try again.");
  reader.readAsText(file);
};
attachClear.onclick = () => {
  attachedNote = null;
  attachChip.classList.remove("show");
};

/* ================= RENDERING ================= */
function mdToHtml(md){
  let t = md
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g,"$1<em>$2</em>")
    .replace(/^### (.*)$/gm,"<h3>$1</h3>")
    .replace(/^## (.*)$/gm,"<h3>$1</h3>");
  const lines = t.split("\n");
  let html = "", inList = false, para = [];
  const flushPara = () => { if(para.length){ html += "<p>"+para.join("<br>")+"</p>"; para=[]; } };
  for(const line of lines){
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if(li){
      flushPara();
      if(!inList){ html += "<ul>"; inList = true; }
      html += "<li>"+li[1]+"</li>";
    } else {
      if(inList){ html += "</ul>"; inList = false; }
      if(line.trim()==="" || line.trim()==="---"){ flushPara(); }
      else para.push(line);
    }
  }
  if(inList) html += "</ul>";
  flushPara();
  return html;
}

function renderBotContent(raw){
  const idx = raw.indexOf("📊");
  let body = raw, score = "";
  if(idx !== -1){
    body  = raw.slice(0, idx).replace(/---\s*$/,"").trim();
    score = raw.slice(idx).trim();
  }
  let bodyHtml = mdToHtml(body);
  bodyHtml = bodyHtml.replace(/<p>(🔧[\s\S]*?)<\/p>/,'<div class="polish"><p>$1</p></div>');
  let html = bodyHtml;
  if(score){
    html += '<div class="scorecard"><span class="stamp">Graded</span>' + mdToHtml(score) + "</div>";
  }
  return html;
}

function addMsg(role, html){
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "bot");
  wrap.innerHTML =
    '<div class="avatar">' + (role === "user" ? "Y" : "") + "</div>" +
    '<div class="bubble">' + html + "</div>";
  thread.appendChild(wrap);
  chatArea.scrollTop = chatArea.scrollHeight;
  return wrap;
}

function updatePointsFrom(text){
  const pm = text.match(/Points Earned This Turn:?\**\s*\+?(\d+)/i);
  if(pm){
    totalPoints += parseInt(pm[1],10);
    totalEl.textContent = totalPoints;
    store.set("lumina_points", String(totalPoints));
    chip.classList.remove("bump"); void chip.offsetWidth; chip.classList.add("bump");
  }
  const sm = text.match(/Current Streak:?\**\s*(\d+)/i);
  if(sm){ streak = parseInt(sm[1],10); streakEl.textContent = streak; store.set("lumina_streak", String(streak)); }
}

/* ================= API (via YOUR proxy — no key in the browser) ================= */
// Set this to whichever provider you configured an env var for on Vercel:
// "groq" | "gemini" | "anthropic"
const PROXY_PROVIDER = "groq";
const PROXY_URL = "/api/chat";

function systemPrompt(){ return mode === "coach" ? COACH_PROMPT : CASUAL_PROMPT; }

async function callViaProxy(){
  let payload;
  if(PROXY_PROVIDER === "groq"){
    payload = {
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt() }, ...messages.map(m => ({ role: m.role, content: m.content }))],
      max_tokens: 1200,
      temperature: 0.7
    };
  } else if(PROXY_PROVIDER === "gemini"){
    payload = {
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 1200, temperature: 0.7 }
    };
  } else {
    payload = { model: CLAUDE_MODEL, max_tokens: 1000, system: systemPrompt(), messages };
  }

  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: PROXY_PROVIDER, payload })
  });
  const data = await res.json();
  if(!res.ok) throw new Error("Proxy error " + res.status + ": " + (data.error || JSON.stringify(data)).toString().slice(0,200));

  if(PROXY_PROVIDER === "groq"){
    const text = data?.choices?.[0]?.message?.content || "";
    if(!text) throw new Error("Groq returned an empty reply.");
    return text;
  }
  if(PROXY_PROVIDER === "gemini"){
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || "").join("\n").trim();
    if(!text) throw new Error("Gemini returned an empty reply (possibly rate-limited).");
    return text;
  }
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

async function callAPI(){
  return callViaProxy();
}

/* ================= SEND ================= */
async function send(){
  const text = input.value.trim();
  if(!text || busy) return;
  busy = true; sendBtn.disabled = true;
  input.value = ""; autoGrow();
  sugBox.innerHTML = "";
  if(listening) stopListening();
  attachedNote = null;
  attachChip.classList.remove("show");

  addMsg("user", mdToHtml(text));
  messages.push({ role: "user", content: text });

  const loader = addMsg("bot",'<div class="typing"><span></span><span></span><span></span></div>');

  try{
    const reply = await callAPI();
    messages.push({ role: "assistant", content: reply });
    loader.querySelector(".bubble").innerHTML = renderBotContent(reply);
    if(mode === "coach") updatePointsFrom(reply);
    speakText(reply);
  }catch(err){
    loader.querySelector(".bubble").innerHTML =
      '<div class="error-note"><b>Couldn\'t reach Lumina.</b> ' +
      'The key hardcoded in app.js may be missing, invalid, or rate-limited. Check the console for details, or update the _K_ENCODED constant in app.js.<br><small>' +
      String(err.message).replace(/</g,"&lt;") + "</small></div>";
  }finally{
    busy = false; sendBtn.disabled = false;
    chatArea.scrollTop = chatArea.scrollHeight;
    input.focus();
  }
}

/* ================= INIT ================= */
function autoGrow(){
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
}
sendBtn.onclick = send;
input.addEventListener("keydown", e => {
  if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); send(); }
});
input.addEventListener("input", autoGrow);

totalEl.textContent = totalPoints;
streakEl.textContent = streak;
refreshSpeakBtn();
applyMode();

addMsg("bot", renderBotContent(WELCOME));
messages.push({ role: "user", content: "Hi" });
messages.push({ role: "assistant", content: WELCOME });
if(mode === "coach" && totalPoints === 0) updatePointsFrom(WELCOME);
input.focus();
