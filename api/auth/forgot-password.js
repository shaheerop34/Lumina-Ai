import { getDb } from "../../lib/db.js";
import { generateSessionToken, hashToken, isValidEmail } from "../../lib/crypto.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESEND_MIN_INTERVAL_MS = 2 * 60 * 1000; // don't re-send within 2 minutes of the last request

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body || {};
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  // Always return the same generic response whether or not the account
  // exists, so this endpoint can't be used to enumerate registered emails.
  const GENERIC_OK = { ok: true };

  try {
    const db = await getDb();
    const user = await db.collection("users").findOne({ email: normalizedEmail });
    if (!user) return res.status(200).json(GENERIC_OK);

    const recent = await db.collection("passwordResets").findOne(
      { userId: user._id, createdAt: { $gte: new Date(Date.now() - RESEND_MIN_INTERVAL_MS) } }
    );
    if (recent) return res.status(200).json(GENERIC_OK);

    const rawToken = generateSessionToken();
    await db.collection("passwordResets").insertOne({
      userId: user._id,
      tokenHash: hashToken(rawToken),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });

    const proto = req.headers["x-forwarded-proto"] || "https";
    const origin = `${proto}://${req.headers.host}`;
    const resetLink = `${origin}/?reset=${rawToken}`;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.error("forgot-password: RESEND_API_KEY is not configured, cannot send email.");
      return res.status(200).json(GENERIC_OK); // don't leak config errors to the client
    }

    const emailResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + resendKey },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "Lumina AI <onboarding@resend.dev>",
        to: normalizedEmail,
        subject: "Reset your Lumina AI password",
        html: `
          <p>Someone requested a password reset for your Lumina AI account.</p>
          <p><a href="${resetLink}">Click here to choose a new password</a> (link expires in 1 hour).</p>
          <p>If you didn't request this, you can safely ignore this email.</p>
        `,
      }),
    });
    if (!emailResp.ok) {
      console.error("forgot-password: Resend API error", emailResp.status, await emailResp.text().catch(() => ""));
    }

    return res.status(200).json(GENERIC_OK);
  } catch (err) {
    console.error("forgot-password error:", err.message);
    return res.status(200).json(GENERIC_OK); // never reveal server errors here either
  }
}
