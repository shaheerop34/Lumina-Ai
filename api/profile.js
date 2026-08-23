// Account-level gamification profile: points, streak, and the last-active
// date used to compute it. Deliberately separate from any one conversation
// (see api/conversations.js) — these persist across every chat a user has,
// the same way they do in the header regardless of which chat is open.
import { ObjectId } from "mongodb";
import { getDb } from "../lib/db.js";
import { getSessionUser } from "../lib/session.js";

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
      const saved = doc?.state || {};
      return res.status(200).json({
        profile: {
          totalPoints: Number.isFinite(saved.totalPoints) ? saved.totalPoints : 0,
          streak: Number.isFinite(saved.streak) ? saved.streak : 1,
          lastActive: typeof saved.lastActive === "string" ? saved.lastActive : "",
        },
      });
    } catch (err) {
      console.error("profile GET error:", err.message);
      return res.status(500).json({ error: "Could not load profile." });
    }
  }

  if (req.method === "POST" || req.method === "PUT") {
    const { totalPoints, streak, lastActive } = req.body || {};
    const profile = {
      totalPoints: Number.isFinite(totalPoints) ? totalPoints : 0,
      streak: Number.isFinite(streak) ? streak : 1,
      lastActive: typeof lastActive === "string" ? lastActive.slice(0, 10) : "",
    };

    try {
      await db.collection("chatState").updateOne(
        { _id: userId },
        { $set: { state: profile, updatedAt: new Date() } },
        { upsert: true }
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("profile POST error:", err.message);
      return res.status(500).json({ error: "Could not save profile." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
