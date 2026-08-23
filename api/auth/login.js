import { getDb } from "../../lib/db.js";
import { verifyPassword, generateSessionToken, hashToken, isValidEmail } from "../../lib/crypto.js";
import { buildSessionCookie, SESSION_MAX_AGE_SECONDS } from "../../lib/cookies.js";
import { isLockedOut, recordAttempt, getClientIp } from "../../lib/rateLimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, password } = req.body || {};
  const ip = getClientIp(req);

  if (!isValidEmail(email) || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "Please enter your email and password." });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const db = await getDb();

    const lockout = await isLockedOut(normalizedEmail, ip);
    if (lockout.locked) {
      return res.status(429).json({
        error: "Too many failed attempts. Please wait 15 minutes and try again.",
      });
    }

    const user = await db.collection("users").findOne({ email: normalizedEmail });

    // Always run bcrypt.compare against SOME hash, even when the user
    // doesn't exist, so responses take the same amount of time either
    // way and an attacker can't use timing to enumerate valid emails.
    const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO6RjLtQhx9OjPMDe1B9WsQAJVEmJoO3W";
    const passwordOk = await verifyPassword(password, user?.passwordHash || DUMMY_HASH);

    if (!user || !passwordOk) {
      await recordAttempt(normalizedEmail, ip, false);
      return res.status(401).json({ error: "Invalid email or password." });
    }

    await recordAttempt(normalizedEmail, ip, true);

    const rawToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

    await db.collection("sessions").insertOne({
      userId: user._id,
      tokenHash: hashToken(rawToken),
      userAgent: req.headers?.["user-agent"] || null,
      ip,
      createdAt: new Date(),
      expiresAt,
    });

    res.setHeader("Set-Cookie", buildSessionCookie(rawToken));
    return res.status(200).json({
      user: { id: user._id.toString(), email: user.email, displayName: user.displayName || null },
    });
  } catch (err) {
    console.error("login error:", err.message);
    return res.status(500).json({ error: "Could not log in. Please try again." });
  }
}
