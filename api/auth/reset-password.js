import { getDb } from "../../lib/db.js";
import { hashPassword, hashToken, isValidPassword } from "../../lib/crypto.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token, newPassword } = req.body || {};
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ error: "Missing or invalid reset link." });
  }
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const db = await getDb();
    const tokenHash = hashToken(token);

    const resetDoc = await db.collection("passwordResets").findOne({ tokenHash });
    if (!resetDoc || new Date(resetDoc.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    }

    const passwordHash = await hashPassword(newPassword);
    await db.collection("users").updateOne({ _id: resetDoc.userId }, { $set: { passwordHash } });

    // The token is single-use, and changing the password invalidates every
    // existing session — anyone who had access via a leaked/old session
    // gets signed out too.
    await db.collection("passwordResets").deleteOne({ tokenHash });
    await db.collection("sessions").deleteMany({ userId: resetDoc.userId });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("reset-password error:", err.message);
    return res.status(500).json({ error: "Could not reset password. Please try again." });
  }
}
