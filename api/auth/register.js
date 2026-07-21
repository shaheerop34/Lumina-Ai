import { getDb } from "../../lib/db.js";
import { hashPassword, generateSessionToken, hashToken, isValidEmail, isValidPassword } from "../../lib/crypto.js";
import { buildSessionCookie, SESSION_MAX_AGE_SECONDS } from "../../lib/cookies.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, password, displayName } = req.body || {};

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const cleanDisplayName = (displayName || "").toString().trim().slice(0, 80) || null;

  try {
    const db = await getDb();
    const users = db.collection("users");

    const existing = await users.findOne({ email: normalizedEmail });
    if (existing) {
      // Same generic message whether the account exists or not, to avoid
      // leaking which emails are registered.
      return res.status(409).json({ error: "That email is already registered." });
    }

    const passwordHash = await hashPassword(password);

    const insertResult = await users.insertOne({
      email: normalizedEmail,
      passwordHash,
      displayName: cleanDisplayName,
      createdAt: new Date(),
    });
    const userId = insertResult.insertedId;

    // Log the user in immediately after registering.
    const rawToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

    await db.collection("sessions").insertOne({
      userId,
      tokenHash: hashToken(rawToken),
      userAgent: req.headers?.["user-agent"] || null,
      createdAt: new Date(),
      expiresAt,
    });

    res.setHeader("Set-Cookie", buildSessionCookie(rawToken));
    return res.status(201).json({
      user: { id: userId.toString(), email: normalizedEmail, displayName: cleanDisplayName },
    });
  } catch (err) {
    // Mongo throws a duplicate-key error (code 11000) if two signups for
    // the same email race each other past the findOne check above.
    if (err.code === 11000) {
      return res.status(409).json({ error: "That email is already registered." });
    }
    console.error("register error:", err.message);
    return res.status(500).json({ error: "Could not create account. Please try again." });
  }
}
