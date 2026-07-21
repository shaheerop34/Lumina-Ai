import { getDb } from "../../lib/db.js";
import { hashToken } from "../../lib/crypto.js";
import { parseCookies, buildClearedSessionCookie, SESSION_COOKIE } from "../../lib/cookies.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cookies = parseCookies(req);
  const rawToken = cookies[SESSION_COOKIE];

  if (rawToken) {
    try {
      const db = await getDb();
      // Delete server-side so the session is invalidated immediately,
      // not just forgotten by this one browser.
      await db.collection("sessions").deleteOne({ tokenHash: hashToken(rawToken) });
    } catch (err) {
      console.error("logout error:", err.message);
      // Still clear the cookie even if the DB call failed.
    }
  }

  res.setHeader("Set-Cookie", buildClearedSessionCookie());
  return res.status(200).json({ ok: true });
}
