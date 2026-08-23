// ============================================================
// THE ACTUAL FIX for keeping your API key safe from attackers.
// ============================================================
// Deploy this folder's parent as a Vercel project (or adapt the
// same idea to a Netlify/Cloudflare function). Then:
//
//   1. In Vercel → Project → Settings → Environment Variables, add:
//        GROQ_API_KEY   = gsk_...           (or)
//        GEMINI_API_KEY = AIzaSy...         (or)
//        ANTHROPIC_API_KEY = sk-ant-...
//      Only set the ONE you're using. This value never goes in
//      any file you commit or ship to the browser.
//
//   2. In app.js, change GROQ_URL / GEMINI_URL / ANTHROPIC_URL to
//      point at "/api/chat" (this function) instead of the
//      provider's URL, and stop sending any key from the browser
//      at all — this function attaches the real key server-side.
//
// With this in place, view-source / devtools on your site will
// NEVER show the real key, because it is never sent to the
// browser in the first place. This is the only setup that is
// actually "safe from attackers" in the way you asked for.
// ============================================================

import { getSessionUser } from "../lib/session.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Require a logged-in user so the AI proxy (and your API costs)
  // can't be used by anyone who just finds this URL.
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Please log in to chat with Lumina." });
  }

  const { provider, payload } = req.body || {};

  // Defense-in-depth: the client already blocks over-limit prompts before
  // sending, but this proxy is a public endpoint, so re-check server-side
  // too — a bypassed/forged request shouldn't be able to force an oversized
  // (and costly) call to the upstream provider.
  const MAX_PAYLOAD_CHARS = 40000;
  const payloadSize = payload ? JSON.stringify(payload).length : 0;
  if (payloadSize > MAX_PAYLOAD_CHARS) {
    return res.status(413).json({
      error: `Request payload exceeds the maximum allowed size of ${MAX_PAYLOAD_CHARS} characters. Please shorten your input.`,
    });
  }

  const key = {
    groq: process.env.GROQ_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
  }[provider];

  if (!key) {
    return res.status(400).json({ error: "Unknown or unconfigured provider: " + provider });
  }

  let url, headers;
  if (provider === "groq") {
    url = "https://api.groq.com/openai/v1/chat/completions";
    headers = { "Content-Type": "application/json", "Authorization": "Bearer " + key };
  } else if (provider === "gemini") {
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + key;
    headers = { "Content-Type": "application/json" };
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    };
  } else {
    return res.status(400).json({ error: "Unsupported provider: " + provider });
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: "Upstream request failed: " + err.message });
  }
}
