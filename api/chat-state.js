import { ObjectId } from "mongodb";
import { getDb } from "../lib/db.js";
import { getSessionUser } from "../lib/session.js";

const MAX_MESSAGES = 200; // keep payloads reasonable; oldest history is trimmed

export default async function handler(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Please log in." });
  }

  const db = await getDb();
  const userId = new ObjectId(user.id);

  if (req.method === "GET") {
    try {
      const doc = await db.collection("chatState").findOne({ _id: userId });
      return res.status(200).json({ state: doc?.state || null });
    } catch (err) {
      console.error("chat-state GET error:", err.message);
      return res.status(500).json({ error: "Could not load saved chat." });
    }
  }

  if (req.method === "POST" || req.method === "PUT") {
    const { messages, totalPoints, streak, mode } = req.body || {};

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages must be an array." });
    }

    // Keep only plain {role, content} pairs, capped in length, so a client
    // can't stuff arbitrary large/odd data into the DB.
    const cleanMessages = messages
      .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
      .slice(-MAX_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) }));

    const state = {
      messages: cleanMessages,
      totalPoints: Number.isFinite(totalPoints) ? totalPoints : 0,
      streak: Number.isFinite(streak) ? streak : 1,
      mode: mode === "casual" ? "casual" : "coach",
    };

    try {
      await db.collection("chatState").updateOne(
        { _id: userId },
        { $set: { state, updatedAt: new Date() } },
        { upsert: true }
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("chat-state POST error:", err.message);
      return res.status(500).json({ error: "Could not save chat." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
