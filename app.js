
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

// Max characters allowed in a single outgoing message. Keeps prompts well
// under the model's context/token ceiling so requests don't get rejected
// upstream — checked BEFORE any state changes, so an over-limit prompt
// never touches busy/messages and the composer text is left untouched
// for the user to shorten and resend.
const MAX_PROMPT_CHARS = 8000;

// Strict word-limit control for AI OUTPUT (not input). This is enforced
// two ways: (1) the system prompt tells the model to stay under it, which
// covers the common case cheaply, and (2) enforceWordLimit() below hard-
// truncates the reply client-side as a guarantee, since LLMs are not
// perfectly reliable word-counters. The limit also drives max_tokens
// (see maxTokensForWordLimit), so a tighter limit means a smaller,
// cheaper, faster request — useful for staying comfortably inside the
// Groq free-tier's tokens-per-minute rate limit.
const DEFAULT_WORD_LIMIT = 150, MIN_WORD_LIMIT = 30, MAX_WORD_LIMIT = 400;

/* -------- System prompt: COACH MODE (full Lumina) -------- */
const COACH_PROMPT = `
## 1. Core Persona & Tone
- Role: You are "Lumina", an expert IELTS tutor and encouraging coach.
- Tone: Professional, encouraging, highly constructive, and engaging.
- Target Audience: IELTS aspirants (Academic and General Training) ranging from beginner to advanced English levels.
- Primary Mandate: Help users improve their English grammar through natural conversation, answer IELTS-related queries (with a heavy focus on the Writing modules), and manage a gamified progression system to keep them motivated.
- Reply Style: Keep replies concise and conversational — avoid dense walls of text. Prefer short paragraphs (2-4 sentences) and bullet points over long unbroken blocks. Stay interactive: where natural, end with a short question or prompt that invites the user's next message.

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
*   **Next Milestone:** [X] points remaining until you unlock [Reward/Rank, e.g., "IELTS Warrior" or "Band 9 Master"]

Note: NEVER output a "Current Streak" line or any specific streak day count, under any circumstances, even if earlier messages in this conversation contain one — the app tracks the user's real daily streak itself from login activity and displays it in the header, and any number you guess will be wrong and confuse the user.

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

Scoring Calibration — score strictly and consistently against the real IELTS Band Descriptors; do not inflate scores to be encouraging:
- A competent but average paragraph — correct grammar, adequate but plain vocabulary, simple-to-mixed sentence structures, an adequately addressed but not fully developed argument — belongs around Band 6.5-7, NOT Band 8 or 9. Band 9 is reserved for near-flawless, sophisticated writing; do not award it, or Band 8, unless the text actually demonstrates wide, natural grammatical range, precise/idiomatic vocabulary, and fully developed, tightly cohesive arguments.
- When uncertain between two adjacent bands, choose the LOWER one. Justify the score against the 4 criteria explicitly rather than defaulting to a high number to sound encouraging — encouragement belongs in the "What Went Well" / tone of the feedback, not in an inflated score.

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
- Keep a warm, conversational, natural tone. Be concise unless depth is asked for — short paragraphs and bullets over dense blocks of text.
- If the user explicitly asks for IELTS help or writing feedback while in this mode, help them normally, but still without points or unsolicited corrections.
`.trim();

const WELCOME = `Hello there! 👋 I'm **Lumina**, your personal IELTS Coach. I'm here to answer your prep questions, grade your writing essays, and help polish your grammar through everyday chat.

To make things fun, you'll earn points for practicing, asking questions, and fixing mistakes. Let's get you that Band 8+! 🚀

To kick things off: **Are you preparing for the Academic or General Training exam, and what is your target Band Score?**

---
📊 **Your Scoreboard:**
*   **Points Earned This Turn:** +10 (First Session Check-in)
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
let conversations = [];          // sidebar metadata: [{id,title,mode,updatedAt,createdAt}, ...]
let activeConversationId = null; // which conversation `messages` currently holds
let totalPoints = parseInt(store.get("lumina_points") || "0", 10) || 0;
let streak = parseInt(store.get("lumina_streak") || "1", 10) || 1;
let lastActive = store.get("lumina_last_active") || ""; // "YYYY-MM-DD" of the last day the streak was counted
// no apiKey variable needed — the proxy attaches auth server-side
let mode = store.get("lumina_mode") || "coach";   // "coach" | "casual"
let busy = false;

function clampWordLimit(n){
  n = Number.isFinite(n) ? Math.round(n) : DEFAULT_WORD_LIMIT;
  return Math.min(MAX_WORD_LIMIT, Math.max(MIN_WORD_LIMIT, n));
}
let wordLimit = clampWordLimit(parseInt(store.get("lumina_word_limit"), 10));

/* ================= DOM ================= */
const thread   = document.getElementById("thread");
const chatArea = document.getElementById("chatArea");
const input    = document.getElementById("input");
const sendBtn  = document.getElementById("sendBtn");
const chip     = document.getElementById("pointsChip");
const totalEl  = document.getElementById("totalPoints");
const streakEl = document.getElementById("streakVal");
const rankEl   = document.getElementById("rankVal");
const banner   = document.getElementById("modeBanner");
const sugBox   = document.getElementById("suggestions");
const btnCoach = document.getElementById("modeCoach");
const btnCasual= document.getElementById("modeCasual");
const micBtn     = document.getElementById("micBtn");
const speakBtn   = document.getElementById("speakBtn");
const wordLimitInput = document.getElementById("wordLimitInput");
const attachBtn  = document.getElementById("attachBtn");
const fileInput  = document.getElementById("fileInput");
const attachChip = document.getElementById("attachChip");
const attachName = document.getElementById("attachName");
const attachClear= document.getElementById("attachClear");

/* ================= ACCOUNT PROFILE SYNC (points/streak, cross-device) =================
   Points, streak, and rank are account-level — the same regardless of
   which conversation is open — so they're persisted separately from any
   one chat's messages, via /api/profile. */
let profileSyncInFlight = false;
async function saveProfileToServer(){
  if(profileSyncInFlight) return;
  profileSyncInFlight = true;
  try{
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ totalPoints, streak, lastActive })
    });
  }catch(e){ /* best-effort — localStorage still has a copy */ }
  finally{ profileSyncInFlight = false; }
}
async function loadProfileFromServer(){
  try{
    const res = await fetch("/api/profile", { credentials: "same-origin" });
    if(!res.ok) return null;
    const data = await res.json();
    return data.profile || null;
  }catch(e){ return null; }
}

/* ================= CONVERSATION SYNC (per-chat history, cross-device) =================
   Each conversation shown in the sidebar is its own document saved via
   /api/conversations — switching or deleting one never touches the
   profile above, the same separation Claude/ChatGPT/Gemini use between
   chat history and account-level stats.

   Resilience: if the server can't be reached (no backend deployed yet,
   offline, etc.), conversations transparently fall back to being saved
   in this browser's localStorage instead — under a "local_"-prefixed id
   — so "New Chat" always actually saves the previous chat into the
   sidebar rather than silently losing it or surfacing a scary error.
   Once fetchConversationList() confirms the server IS reachable,
   everything goes back to being saved for real, cross-device. */
const LOCAL_CONVOS_KEY = "lumina_local_conversations";
let useLocalConversations = false; // set once in initChatUI if the server is unreachable at load time

function readLocalConvos(){
  try{ return JSON.parse(store.get(LOCAL_CONVOS_KEY) || "[]"); }catch(e){ return []; }
}
function writeLocalConvos(list){ store.set(LOCAL_CONVOS_KEY, JSON.stringify(list)); }
function newLocalId(){ return "local_" + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function toListMeta(c){ return { id: c.id, title: c.title, mode: c.mode, updatedAt: c.updatedAt, createdAt: c.createdAt }; }

function createLocalConversation(initialMessages){
  const now = new Date().toISOString();
  const convo = { id: newLocalId(), title: "New Chat", mode, messages: initialMessages, updatedAt: now, createdAt: now };
  const list = readLocalConvos();
  list.unshift(convo);
  writeLocalConvos(list);
  return toListMeta(convo);
}

let conversationSyncInFlight = false;
async function fetchConversationList(){
  try{
    const res = await fetch("/api/conversations", { credentials: "same-origin" });
    if(!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.conversations) ? data.conversations : [];
  }catch(e){ return null; }
}
async function createConversationOnServer(initialMessages){
  if(!useLocalConversations){
    try{
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ mode, messages: initialMessages })
      });
      if(res.ok) return await res.json(); // { id, title, mode, updatedAt, createdAt }
    }catch(e){ /* fall through to local */ }
  }
  // Server unreachable — either for this whole session, or just this one
  // call — fall back to saving locally so the chat is never lost and
  // still shows up in the sidebar right away.
  return createLocalConversation(initialMessages);
}
async function loadConversationFromServer(id){
  if(id.startsWith("local_")){
    const convo = readLocalConvos().find(c => c.id === id);
    return convo ? { id: convo.id, title: convo.title, mode: convo.mode, messages: convo.messages } : null;
  }
  try{
    const res = await fetch("/api/conversations/" + encodeURIComponent(id), { credentials: "same-origin" });
    if(!res.ok) return null;
    const data = await res.json();
    return data.conversation || null;
  }catch(e){ return null; }
}
async function saveConversationToServer(){
  if(!activeConversationId || conversationSyncInFlight) return;
  conversationSyncInFlight = true;
  const meta = conversations.find(c => c.id === activeConversationId);
  try{
    if(activeConversationId.startsWith("local_")){
      const list = readLocalConvos();
      const idx = list.findIndex(c => c.id === activeConversationId);
      const now = new Date().toISOString();
      const record = {
        id: activeConversationId,
        title: (meta && meta.title) || (idx !== -1 ? list[idx].title : "New Chat"),
        mode, messages, updatedAt: now,
        createdAt: idx !== -1 ? list[idx].createdAt : now,
      };
      if(idx !== -1) list[idx] = record; else list.unshift(record);
      writeLocalConvos(list);
    } else {
      await fetch("/api/conversations/" + encodeURIComponent(activeConversationId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ messages, mode, title: meta ? meta.title : undefined })
      });
    }
  }catch(e){ /* best-effort */ }
  finally{ conversationSyncInFlight = false; }
}
async function deleteConversationOnServer(id){
  if(id.startsWith("local_")){
    writeLocalConvos(readLocalConvos().filter(c => c.id !== id));
    return true;
  }
  try{
    const res = await fetch("/api/conversations/" + encodeURIComponent(id), { method: "DELETE", credentials: "same-origin" });
    return res.ok;
  }catch(e){ return false; }
}

/* ================= WORD LIMIT CONTROL ================= */
wordLimitInput.value = wordLimit;
wordLimitInput.addEventListener("change", () => {
  wordLimit = clampWordLimit(parseInt(wordLimitInput.value, 10));
  wordLimitInput.value = wordLimit;
  store.set("lumina_word_limit", String(wordLimit));
});

// ~1.4 tokens per English word on average, plus a fixed buffer for
// markdown formatting and the scoreboard block. Scaling max_tokens with
// the user's word limit (instead of always requesting the max) keeps
// each Groq request smaller and faster and helps stay well inside the
// free tier's tokens-per-minute rate limit.
function maxTokensForWordLimit(){
  return Math.max(220, Math.min(1200, Math.ceil(wordLimit * 1.4) + 150));
}

// Hard fallback in case the model overshoots the word limit it was told
// to respect: truncates the reply BODY (leaving the "📊 Scoreboard" block,
// if present, untouched) to `limit` words, preferring to cut at the last
// full sentence rather than mid-word.
function enforceWordLimit(rawReply, limit){
  const idx = rawReply.indexOf("📊");
  const body = idx !== -1 ? rawReply.slice(0, idx) : rawReply;
  const tail = idx !== -1 ? rawReply.slice(idx) : "";
  const words = body.trim().split(/\s+/).filter(Boolean);
  if(words.length <= limit) return rawReply; // already within limit — leave untouched
  const cut = words.slice(0, limit).join(" ");
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const clean = lastStop > cut.length * 0.6 ? cut.slice(0, lastStop + 1).trim() : cut.trim() + "…";
  return tail ? clean + "\n\n---\n" + tail : clean;
}

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
  const meta = conversations.find(c => c.id === activeConversationId);
  if(meta) meta.mode = m;
  saveConversationToServer();
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

/* ================= VOICE: SPEAK REPLIES (text → speech), prosody-aware =================
   The Web Speech API has no reliable cross-browser SSML support (Chrome
   just reads <break>/<emphasis> tags aloud as literal text), so natural
   pauses and tone shifts are produced manually instead: the cleaned reply
   is split into punctuation-bounded clauses, and each clause is queued as
   its OWN utterance with a hand-tuned pause/pitch/rate before the next
   one starts — giving commas a short breath, sentence-enders a longer
   one, "?" a rising pitch, and "!" a touch more energy, instead of one
   flat monotone utterance that reads punctuation as silence or ignores
   it entirely. */
let speakEnabled = store.get("lumina_speak") === "1";
const synth = window.speechSynthesis;
let speechGeneration = 0; // bumped on every stop/restart so stale queued clauses abort instead of playing late

function refreshSpeakBtn(){
  speakBtn.classList.toggle("active", speakEnabled);
  speakBtn.textContent = speakEnabled ? "🔊 Speak: On" : "🔈 Speak: Off";
  speakBtn.setAttribute("aria-pressed", String(speakEnabled));
}
function stopSpeaking(){
  speechGeneration++; // invalidate any pending queued clause BEFORE cancelling the current one
  if(synth) synth.cancel();
}

function sanitizeForSpeech(rawText){
  return rawText
    .replace(/📊[\s\S]*$/,"")                     // drop the scoreboard block
    .replace(/^\s*-{3,}\s*$/gm,"")                 // drop markdown "---" divider lines entirely
    .replace(/[*_#>`]/g,"")
    .replace(/🔧\s*Quick Polish:?/gi,"Quick polish. ")
    // Abbreviations like "e.g." / "i.e." / "etc." end in a period that
    // isn't a real sentence break — left alone it makes tokenizeForProsody
    // insert a full-stop-length pause mid-sentence, which is what was
    // making the pacing feel off. Drop just their trailing dot.
    .replace(/\b(e\.g|i\.e|etc|vs|approx|Mr|Mrs|Ms|Dr|Jr|Sr)\./gi, "$1")
    // Em/en dashes and double-hyphens are a parenthetical pause in written
    // English, NOT a word — left in, some voices literally read them aloud
    // as "dash" / "dash dash". Convert to a natural comma-level pause instead.
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s*--+\s*/g, ", ")
    // Parenthetical asides: read as comma pauses on both sides rather than
    // leaving literal "(" ")" characters for the engine to stumble over.
    .replace(/[()]/g, ", ")
    .replace(/,(\s*,)+/g, ",")           // collapse doubled-up commas from the replacements above
    .replace(/,\s*([.!?;:])/g, "$1")     // drop a comma sitting right before another punctuation mark
    .replace(/\s+/g," ")
    .trim();
}

// Splits text into clauses on SENTENCE-level punctuation only (. ! ? ; :) —
// commas are deliberately NOT a split point. Every synth.speak() call has
// its own engine startup overhead, and splitting a fresh utterance for
// every single comma (the previous version) meant that overhead got paid
// once per comma across a whole reply — that per-utterance tax, not the
// pause values themselves, was the main reason speech felt sluggish.
// Commas stay embedded in their clause's text instead; the speech engine
// already gives a real comma a small natural pause on its own.
// BASE_RATE is bumped above the engine default of 1 because "normal" is a
// noticeably slow, deliberate pace on most voices for a conversational
// assistant.
function tokenizeForProsody(text){
  const BASE_RATE = 1.15, BASE_PITCH = 1;
  const rawChunks = text.match(/[^.!?;:]+[.!?;:]?/g) || [text];
  return rawChunks.map(chunk => {
    const trimmed = chunk.trim();
    if(!trimmed) return null;
    const mark = trimmed.slice(-1);
    let pause = 90, rate = BASE_RATE, pitch = BASE_PITCH;
    if(mark === ";" || mark === ":"){ pause = 100; }                            // medium breath
    else if(mark === "."){ pause = 140; }                                       // full stop
    else if(mark === "!"){ pause = 140; rate = BASE_RATE * 1.05; pitch = BASE_PITCH * 1.08; } // excited
    else if(mark === "?"){ pause = 160; pitch = BASE_PITCH * 1.12; }            // rising, questioning
    return { text: trimmed, pause, rate, pitch };
  }).filter(Boolean);
}

function speakText(rawText){
  if(!speakEnabled || !synth) return;
  const clean = sanitizeForSpeech(rawText);
  if(!clean) return;

  stopSpeaking(); // cancel anything already playing and invalidate its queue
  const myGen = speechGeneration; // this playback's own generation id

  // Pause live transcription while Lumina talks (across the WHOLE queued
  // sequence, not just the first clause), resume once she's fully done.
  const wasListening = listening;
  if(wasListening) stopListening();

  const chunks = tokenizeForProsody(clean);
  let i = 0;
  function playNext(){
    if(myGen !== speechGeneration) return; // superseded by a newer speakText()/stopSpeaking() call
    if(i >= chunks.length){
      if(wasListening) startListening();
      return;
    }
    const { text, pause, rate, pitch } = chunks[i++];
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = rate;
    utter.pitch = pitch;
    const advance = () => { if(myGen === speechGeneration) setTimeout(playNext, pause); };
    utter.onend = advance;
    utter.onerror = advance;
    synth.speak(utter);
  }
  playNext();
}
speakBtn.onclick = () => {
  speakEnabled = !speakEnabled;
  store.set("lumina_speak", speakEnabled ? "1" : "0");
  refreshSpeakBtn();
  if(!speakEnabled) stopSpeaking();
};
if(!synth){ speakBtn.disabled = true; speakBtn.title = "Speech playback isn't supported in this browser"; }

/* ================= GLOBAL DYNAMIC THEME ENGINE =================
   Each theme below defines exactly 3 colors: primary/secondary/accent.
   Every button, border, shadow, card and the ambient background in
   styles.css derives its color from the --emerald/--violet/--gold root
   variables (via CSS relative-color syntax, e.g.
   rgb(from var(--emerald) r g b / .25)), so reassigning just these 3
   custom properties on <html> instantly re-themes the ENTIRE app in one
   step — header, composer, message bubbles, scorecard, auth screen,
   everything — with no per-component JS needed. */
const GRADIENT_THEMES = {
  default: { label: "Emerald / Violet", primary: "#10B981", secondary: "#8B5CF6", accent: "#F59E0B" },
  sunset:  { label: "Sunset",           primary: "#F59E0B", secondary: "#F87171", accent: "#FBBF24" },
  ocean:   { label: "Ocean",            primary: "#3B82F6", secondary: "#06B6D4", accent: "#38BDF8" },
  forest:  { label: "Forest",           primary: "#22C55E", secondary: "#15803D", accent: "#84CC16" },
  mono:    { label: "Monochrome",       primary: "#9CA3AF", secondary: "#6B7280", accent: "#D1D5DB" },
};

const rootStyle             = document.documentElement.style;
const ambientEl             = document.querySelector(".ambient");
const gradientToggle        = document.getElementById("gradientToggle");
const themeDropdown         = document.getElementById("themeDropdown");
const themeDropdownTrigger  = document.getElementById("themeDropdownTrigger");
const themeDropdownMenu     = document.getElementById("themeDropdownMenu");
const themeDropdownLabel    = document.getElementById("themeDropdownLabel");
const themeSwatchCurrent    = document.getElementById("themeSwatchCurrent");

let gradientEnabled = store.get("lumina_gradient_enabled") !== "0"; // ambient glow on by default
let gradientTheme    = GRADIENT_THEMES[store.get("lumina_gradient_theme")] ? store.get("lumina_gradient_theme") : "default";
let themeMenuOpen = false;
let focusedOptionIndex = -1;

function applyThemeColors(key){
  const t = GRADIENT_THEMES[key] || GRADIENT_THEMES.default;
  rootStyle.setProperty("--emerald", t.primary);
  rootStyle.setProperty("--violet", t.secondary);
  rootStyle.setProperty("--gold", t.accent);
}

function buildThemeMenu(){
  themeDropdownMenu.innerHTML = "";
  Object.entries(GRADIENT_THEMES).forEach(([key, t]) => {
    const li = document.createElement("li");
    li.id = "themeOption-" + key;
    li.setAttribute("role", "option");
    li.dataset.theme = key;
    li.setAttribute("aria-selected", String(key === gradientTheme));
    li.innerHTML =
      `<span class="theme-swatch" style="--swatch-a:${t.primary};--swatch-b:${t.secondary}" aria-hidden="true"></span>` +
      `<span>${t.label}</span>`;
    li.addEventListener("click", () => selectTheme(key));
    themeDropdownMenu.appendChild(li);
  });
}

function refreshThemeUI(){
  const t = GRADIENT_THEMES[gradientTheme] || GRADIENT_THEMES.default;
  applyThemeColors(gradientTheme); // button/border/shadow theming always applies...
  ambientEl.classList.toggle("gradient-off", !gradientEnabled); // ...only the ambient glow itself toggles off

  themeDropdownLabel.textContent = t.label;
  themeSwatchCurrent.style.setProperty("--swatch-a", t.primary);
  themeSwatchCurrent.style.setProperty("--swatch-b", t.secondary);
  [...themeDropdownMenu.children].forEach(li => li.setAttribute("aria-selected", String(li.dataset.theme === gradientTheme)));

  gradientToggle.classList.toggle("active", gradientEnabled);
  gradientToggle.textContent = gradientEnabled ? "🌈 Gradient: On" : "⬛ Gradient: Off";
  gradientToggle.setAttribute("aria-pressed", String(gradientEnabled));
  themeDropdownTrigger.disabled = !gradientEnabled;
}

function selectTheme(key){
  gradientTheme = GRADIENT_THEMES[key] ? key : "default";
  store.set("lumina_gradient_theme", gradientTheme);
  refreshThemeUI();
  closeThemeMenu();
  themeDropdownTrigger.focus();
}

/* ---- Custom listbox open/close + keyboard nav (ARIA "select-only combobox" pattern) ---- */
function updateOptionFocus(options){
  options.forEach((li, i) => li.classList.toggle("focused", i === focusedOptionIndex));
  const active = options[focusedOptionIndex];
  if(active){
    themeDropdownTrigger.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  }
}
function openThemeMenu(){
  if(themeDropdownTrigger.disabled || themeMenuOpen) return;
  themeMenuOpen = true;
  themeDropdownMenu.classList.add("open");
  themeDropdownTrigger.setAttribute("aria-expanded", "true");
  const options = [...themeDropdownMenu.children];
  focusedOptionIndex = Math.max(0, options.findIndex(li => li.dataset.theme === gradientTheme));
  updateOptionFocus(options);
  document.addEventListener("click", onDocClickCloseMenu);
  document.addEventListener("keydown", onMenuKeydown);
}
function closeThemeMenu(){
  if(!themeMenuOpen) return;
  themeMenuOpen = false;
  themeDropdownMenu.classList.remove("open");
  themeDropdownTrigger.setAttribute("aria-expanded", "false");
  themeDropdownTrigger.removeAttribute("aria-activedescendant");
  [...themeDropdownMenu.children].forEach(li => li.classList.remove("focused"));
  document.removeEventListener("click", onDocClickCloseMenu);
  document.removeEventListener("keydown", onMenuKeydown);
}
function onDocClickCloseMenu(e){
  if(!themeDropdown.contains(e.target)) closeThemeMenu();
}
function onMenuKeydown(e){
  const options = [...themeDropdownMenu.children];
  if(!options.length) return;
  switch(e.key){
    case "ArrowDown": e.preventDefault(); focusedOptionIndex = (focusedOptionIndex + 1) % options.length; updateOptionFocus(options); break;
    case "ArrowUp":   e.preventDefault(); focusedOptionIndex = (focusedOptionIndex - 1 + options.length) % options.length; updateOptionFocus(options); break;
    case "Home":      e.preventDefault(); focusedOptionIndex = 0; updateOptionFocus(options); break;
    case "End":       e.preventDefault(); focusedOptionIndex = options.length - 1; updateOptionFocus(options); break;
    case "Enter":
    case " ":         e.preventDefault(); if(options[focusedOptionIndex]) selectTheme(options[focusedOptionIndex].dataset.theme); break;
    case "Escape":    e.preventDefault(); closeThemeMenu(); themeDropdownTrigger.focus(); break;
    case "Tab":       closeThemeMenu(); break;
  }
}
themeDropdownTrigger.addEventListener("click", () => (themeMenuOpen ? closeThemeMenu() : openThemeMenu()));
themeDropdownTrigger.addEventListener("keydown", (e) => {
  if(!themeMenuOpen && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")){
    e.preventDefault();
    openThemeMenu();
  }
});

gradientToggle.onclick = () => {
  gradientEnabled = !gradientEnabled;
  store.set("lumina_gradient_enabled", gradientEnabled ? "1" : "0");
  refreshThemeUI();
};

buildThemeMenu();
refreshThemeUI();

/* ================= SIDEBAR: CHAT HISTORY (New Chat / switch / delete) =================
   Mirrors the Claude/ChatGPT/Gemini pattern: an ever-growing list of
   separate conversations in the sidebar, a prominent "+ New Chat" button,
   and per-item delete. Switching or deleting a conversation NEVER touches
   totalPoints/streak/rank — those are account-level (see the profile sync
   above), not per-chat. */
const sidebarEl          = document.getElementById("sidebar");
const sidebarBackdrop    = document.getElementById("sidebarBackdrop");
const sidebarToggleBtn   = document.getElementById("sidebarToggle");
const newChatBtn         = document.getElementById("newChatBtn");
const conversationListEl = document.getElementById("conversationList");

function isMobileSidebar(){
  return window.matchMedia("(max-width: 860px)").matches;
}
function updateSidebarToggleAria(){
  const expanded = isMobileSidebar()
    ? sidebarEl.classList.contains("open")
    : !sidebarEl.classList.contains("collapsed");
  sidebarToggleBtn.setAttribute("aria-expanded", String(expanded));
}
function openSidebar(){
  if(isMobileSidebar()){
    sidebarEl.classList.add("open");
    sidebarBackdrop.classList.add("show");
  } else {
    sidebarEl.classList.remove("collapsed");
  }
  updateSidebarToggleAria();
}
function closeSidebar(){
  if(isMobileSidebar()){
    sidebarEl.classList.remove("open");
    sidebarBackdrop.classList.remove("show");
  } else {
    sidebarEl.classList.add("collapsed");
  }
  updateSidebarToggleAria();
}
function toggleSidebar(){
  const currentlyOpen = isMobileSidebar() ? sidebarEl.classList.contains("open") : !sidebarEl.classList.contains("collapsed");
  currentlyOpen ? closeSidebar() : openSidebar();
}
sidebarToggleBtn.onclick = toggleSidebar;
sidebarBackdrop.onclick = closeSidebar;
updateSidebarToggleAria(); // correct the initial aria-expanded for whichever viewport loaded first

function escapeHtml(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function relativeTime(iso){
  if(!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if(mins < 1) return "Just now";
  if(mins < 60) return mins + "m";
  const hrs = Math.round(mins / 60);
  if(hrs < 24) return hrs + "h";
  const days = Math.round(hrs / 24);
  if(days < 7) return days + "d";
  return new Date(iso).toLocaleDateString();
}
// The first two seeded messages are always {user:"Hi"}/{assistant:WELCOME};
// title a conversation from the first REAL user message instead.
function titleFromMessages(msgs){
  const real = (msgs || []).find(m => m.role === "user" && m.content && m.content.trim() && m.content.trim() !== "Hi");
  const clean = (real ? real.content : "").replace(/\s+/g," ").trim();
  return clean ? (clean.length > 48 ? clean.slice(0,48).trim() + "…" : clean) : "New Chat";
}

function renderConversationList(){
  conversationListEl.innerHTML = "";
  conversations.forEach(c => {
    const li = document.createElement("li");
    li.className = "conversation-item" + (c.id === activeConversationId ? " active" : "");
    li.dataset.id = c.id;
    li.tabIndex = 0;
    li.innerHTML =
      `<span class="title">${escapeHtml(c.title || "New Chat")}</span>` +
      `<span class="time">${relativeTime(c.updatedAt)}</span>` +
      `<button class="delete-btn" type="button" aria-label="Delete conversation" title="Delete conversation">🗑</button>`;
    li.addEventListener("click", (e) => {
      if(e.target.closest(".delete-btn")) return;
      if(c.id !== activeConversationId) switchToConversation(c.id);
      if(isMobileSidebar()) closeSidebar();
    });
    li.addEventListener("keydown", (e) => {
      if((e.key === "Enter" || e.key === " ") && !e.target.closest(".delete-btn")){
        e.preventDefault();
        if(c.id !== activeConversationId) switchToConversation(c.id);
      }
    });
    li.querySelector(".delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      handleDeleteConversation(c.id);
    });
    conversationListEl.appendChild(li);
  });
}

function resetThreadUI(){
  thread.innerHTML = "";
  sugBox.innerHTML = "";
  attachedNote = null;
  attachChip.classList.remove("show");
  if(listening) stopListening();
  stopSpeaking();
}

async function switchToConversation(id){
  const conv = await loadConversationFromServer(id);
  if(!conv){
    addSystemNote("⚠️ Couldn't load that conversation — please try again.");
    return;
  }
  activeConversationId = conv.id;
  messages = Array.isArray(conv.messages) ? conv.messages : [];
  mode = conv.mode === "casual" ? "casual" : "coach";
  store.set("lumina_mode", mode);
  applyMode();

  resetThreadUI();
  if(messages.length){
    messages.forEach(m => {
      if(m.role === "user") addMsg("user", mdToHtml(m.content));
      else addMsg("bot", renderBotContent(m.content));
    });
  } else {
    addMsg("bot", renderBotContent(WELCOME));
  }
  renderSuggestions();
  renderConversationList();
  input.focus();
}

// isFirstEver gates the one-time "+10 First Session Check-in" bonus so
// it can never be re-triggered just by clicking "+ New Chat" repeatedly.
async function startNewChat({ isFirstEver = false } = {}){
  resetThreadUI();
  const initialMessages = [{ role: "user", content: "Hi" }, { role: "assistant", content: WELCOME }];
  messages = initialMessages.slice();

  // createConversationOnServer() always succeeds — it falls back to a
  // local browser-storage conversation if the server can't be reached,
  // so the previous chat is never silently lost.
  const created = await createConversationOnServer(initialMessages);
  activeConversationId = created.id;
  conversations.unshift(created);

  addMsg("bot", renderBotContent(WELCOME));
  if(isFirstEver && mode === "coach" && totalPoints === 0){
    updatePointsFrom(WELCOME);
  }
  renderSuggestions();
  renderConversationList();
  await saveProfileToServer();
  input.focus();
}
newChatBtn.onclick = () => startNewChat();

async function handleDeleteConversation(id){
  if(!window.confirm("Delete this conversation? This can't be undone.")) return;
  const ok = await deleteConversationOnServer(id);
  if(!ok){
    addSystemNote("⚠️ Couldn't delete that conversation — please try again.");
    return;
  }
  conversations = conversations.filter(c => c.id !== id);
  if(id === activeConversationId){
    if(conversations.length){
      await switchToConversation(conversations[0].id);
    } else {
      await startNewChat();
    }
  } else {
    renderConversationList();
  }
}

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

/* ================= RANK (deterministic, derived from real totalPoints) =================
   Like the streak, rank is computed here from a number the app already
   trusts (totalPoints) rather than asking the model to name a rank —
   so it can never drift from what's shown in the header. */
const RANKS = [
  { min: 0,    label: "Newcomer" },
  { min: 40,   label: "IELTS Novice" },
  { min: 120,  label: "Grammar Apprentice" },
  { min: 250,  label: "IELTS Warrior" },
  { min: 500,  label: "Fluency Fighter" },
  { min: 900,  label: "Band 8 Achiever" },
  { min: 1500, label: "Band 9 Master" },
];
function currentRank(points){
  let rank = RANKS[0];
  for(const r of RANKS){ if(points >= r.min) rank = r; else break; }
  return rank;
}
function refreshRankUI(){
  rankEl.textContent = currentRank(totalPoints).label;
}

function updatePointsFrom(text){
  const pm = text.match(/Points Earned This Turn:?\**\s*\+?(\d+)/i);
  if(pm){
    const rankBefore = currentRank(totalPoints).label;
    totalPoints += parseInt(pm[1],10);
    totalEl.textContent = totalPoints;
    store.set("lumina_points", String(totalPoints));
    chip.classList.remove("bump"); void chip.offsetWidth; chip.classList.add("bump");
    refreshRankUI();
    const rankAfter = currentRank(totalPoints).label;
    if(rankAfter !== rankBefore){
      addSystemNote(`🎉 <b>Rank up!</b> You're now ranked <b>${rankAfter}</b>.`);
    }
  }
  // Streak is NOT parsed from the model's reply — it's real, calendar-based
  // daily-activity tracking computed by computeDailyStreak() below, so it
  // can't drift from whatever number the LLM happens to hallucinate.
}

/* ================= DAILY STREAK (real, calendar-based) =================
   Tracks actual consecutive daily logins/visits rather than trusting the
   LLM's own text. A "day" is the user's local calendar date. */
function todayStr(){
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function daysBetween(fromStr, toStr){
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
// Returns { broke, gapDays } so the caller can decide WHEN to surface the
// "streak broken" notice (e.g. after restored history has rendered),
// instead of popping it up mid-calculation.
function computeDailyStreak(){
  const today = todayStr();
  const gapDays = lastActive ? daysBetween(lastActive, today) : null;
  let broke = false;
  if(lastActive === today){
    // Already counted today (e.g. reopened the tab) — leave streak as-is.
  } else if(gapDays === 1){
    streak += 1; // came back the very next calendar day
  } else {
    if(lastActive && streak > 1) broke = true; // there was a real streak running before this gap
    streak = 1; // first-ever visit, or a gap of 2+ days broke the streak
  }
  lastActive = today;
  store.set("lumina_streak", String(streak));
  store.set("lumina_last_active", lastActive);
  streakEl.textContent = streak;
  return { broke, gapDays };
}

/* ================= API (via YOUR proxy — no key in the browser) ================= */
// Set this to whichever provider you configured an env var for on Vercel:
// "groq" | "gemini" | "anthropic"
const PROXY_PROVIDER = "groq";
const PROXY_URL = "/api/chat";

function systemPrompt(){
  const base = mode === "coach" ? COACH_PROMPT : CASUAL_PROMPT;
  return base + `\n\n## Output Length Constraint\nYour ENTIRE reply (excluding any "📊 Your Scoreboard" block) MUST be ${wordLimit} words or fewer. Count your words as you write and stop before exceeding this — do not pad the response to reach the limit, and do not mention this constraint to the user.`;
}

async function callViaProxy(){
  let payload;
  const maxTokens = maxTokensForWordLimit();
  if(PROXY_PROVIDER === "groq"){
    payload = {
      model: GROQ_MODEL,
      messages: [{ role: "system", content: systemPrompt() }, ...messages.map(m => ({ role: m.role, content: m.content }))],
      max_tokens: maxTokens,
      temperature: 0.7
    };
  } else if(PROXY_PROVIDER === "gemini"){
    payload = {
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
    };
  } else {
    payload = { model: CLAUDE_MODEL, max_tokens: maxTokens, system: systemPrompt(), messages };
  }

  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ provider: PROXY_PROVIDER, payload })
  });
  const data = await res.json();
  if(res.status === 401){
    if(window.LuminaAuth && window.LuminaAuth.forceReauth) window.LuminaAuth.forceReauth();
    throw new Error("Your session expired — please log in again.");
  }
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
  if(text.length > MAX_PROMPT_CHARS){
    addSystemNote(
      `⚠️ <b>Error:</b> Your message is ${text.length.toLocaleString()} characters, which exceeds ` +
      `the maximum limit of ${MAX_PROMPT_CHARS.toLocaleString()} characters. Please shorten your input and try again.`
    );
    return; // no state touched — busy/messages untouched, composer text kept so the user can edit it
  }
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
    const raw = await callAPI();
    // Hard guarantee (belt-and-suspenders alongside the system-prompt
    // instruction): the model can still fabricate a "Current Streak: N
    // Days" line despite being told not to, especially a smaller free-tier
    // model — strip it outright so the header's real, calendar-based
    // streak number is never contradicted in the chat itself.
    const withoutStreakLine = raw
      .split("\n")
      .filter(line => !/current\s*streak/i.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    const reply = enforceWordLimit(withoutStreakLine, wordLimit); // hard fallback if the model overshot the word limit
    messages.push({ role: "assistant", content: reply });
    loader.querySelector(".bubble").innerHTML = renderBotContent(reply);
    if(mode === "coach") updatePointsFrom(reply);
    speakText(reply);

    // Keep the sidebar's title/ordering fresh without a full re-fetch:
    // rename a still-untitled conversation from the first real message,
    // and bump it to the top like every popular chat app does.
    const idx = conversations.findIndex(c => c.id === activeConversationId);
    if(idx !== -1){
      if(conversations[idx].title === "New Chat") conversations[idx].title = titleFromMessages(messages);
      conversations[idx].updatedAt = new Date().toISOString();
      const [item] = conversations.splice(idx, 1);
      conversations.unshift(item);
      renderConversationList();
    }

    await saveConversationToServer();
    await saveProfileToServer();
  }catch(err){
    loader.querySelector(".bubble").innerHTML =
      '<div class="error-note"><b>Couldn\'t reach Lumina.</b> ' +
      'The /api/chat proxy didn\'t respond correctly — check that api/chat.js is at your project root (not nested in a subfolder) and that GROQ_API_KEY is set in Vercel → Settings → Environment Variables, then redeploy.<br><small>' +
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

async function initChatUI(){
  refreshSpeakBtn();

  // ---- Account-level profile: points/streak/rank — independent of any
  // single conversation, loaded once regardless of which chat opens. ----
  const profile = await loadProfileFromServer();
  if(profile){
    totalPoints = Number.isFinite(profile.totalPoints) ? profile.totalPoints : totalPoints;
    streak = Number.isFinite(profile.streak) ? profile.streak : streak;
    lastActive = typeof profile.lastActive === "string" && profile.lastActive ? profile.lastActive : lastActive;
    store.set("lumina_points", String(totalPoints));
  }
  totalEl.textContent = totalPoints;
  refreshRankUI();
  const { broke, gapDays } = computeDailyStreak(); // may bump the streak if today is a new consecutive day
  await saveProfileToServer(); // persist any streak bump from the line above right away

  // ---- Conversation list + whichever one was active most recently ----
  // If the server can't be reached, transparently switch to conversations
  // saved in this browser's localStorage instead — same sidebar, same
  // New Chat/switch/delete behavior, just not synced cross-device until
  // the server is reachable again.
  const list = await fetchConversationList();
  let usingLocalFallback = false;
  if(list === null){
    useLocalConversations = true;
    usingLocalFallback = true;
    conversations = readLocalConvos().map(toListMeta);
  } else {
    conversations = list;
  }

  if(conversations.length){
    await switchToConversation(conversations[0].id); // most recently updated
    if(usingLocalFallback){
      addSystemNote("💾 The server isn't reachable right now — chats are being saved in this browser instead of your account until it's back.");
    } else {
      addSystemNote("👋 Welcome back — your chat picked up right where you left off.");
    }
    if(broke){
      addSystemNote(`💔 <b>Streak broken</b> — you were away for ${gapDays} day${gapDays === 1 ? "" : "s"}, so your daily streak has reset to <b>Day 1</b>. Come back daily to build it back up!`);
    }
  } else {
    // Genuinely brand-new account — normal welcome flow, first-ever bonus included.
    await startNewChat({ isFirstEver: true });
    if(usingLocalFallback){
      addSystemNote("💾 The server isn't reachable right now — chats are being saved in this browser instead of your account until it's back.");
    }
  }

  input.focus();
}

// Called once by auth.js after a session is confirmed (either an
// existing cookie on page load, or a fresh login/signup). This keeps
// the chat — and the API calls it makes — behind a real login.
window.startLuminaChat = initChatUI;
