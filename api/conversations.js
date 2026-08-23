// Sidebar chat history: list every conversation a user has, or start a new
// one. Each conversation is its own document — separate from the account-
// level profile (see api/profile.js) — so switching chats never touches
// points/streak, matching how Claude/ChatGPT/Gemini separate the two.
import { ObjectId } from "mongodb";
import { getDb } from "../lib/db.js";
import { getSessionUser } from "../lib/session.js";
import { sanitizeMessages } from "../lib/conversations.js";

function toListItem(doc) {
  return {
    id: doc._id.toString(),
    title: doc.title || "New Chat",
    mode: doc.mode === "casual" ? "casual" : "coach",
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
  };
}

export default async function handler(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Please log in." });
  }

  const db = await getDb();
  const userId = new ObjectId(user.id);
  const col = db.collection("conversations");

  if (req.method === "GET") {
    try {
      let docs = await col
        .find({ userId })
        .sort({ updatedAt: -1 })
        .limit(100)
        .toArray();

      // One-time migration: accounts created before multi-chat history
      // existed have their single conversation sitting in the old
      // chatState.state.messages blob. Bring it forward instead of
      // silently losing it the first time this endpoint is hit.
      if (docs.length === 0) {
        const legacy = await db.collection("chatState").findOne({ _id: userId });
        const legacyMessages = legacy?.state?.messages;
        if (Array.isArray(legacyMessages) && legacyMessages.length) {
          const migrated = {
            userId,
            title: "Previous Chat",
            mode: legacy.state.mode === "casual" ? "casual" : "coach",
            messages: sanitizeMessages(legacyMessages),
            createdAt: legacy.updatedAt || new Date(),
            updatedAt: legacy.updatedAt || new Date(),
          };
          const inserted = await col.insertOne(migrated);
          docs = [{ _id: inserted.insertedId, ...migrated }];
        }
      }

      return res.status(200).json({ conversations: docs.map(toListItem) });
    } catch (err) {
      console.error("conversations GET error:", err.message);
      return res.status(500).json({ error: "Could not load conversations." });
    }
  }

  if (req.method === "POST") {
    const { title, mode, messages } = req.body || {};
    const doc = {
      userId,
      title: typeof title === "string" && title.trim() ? title.trim().slice(0, 60) : "New Chat",
      mode: mode === "casual" ? "casual" : "coach",
      messages: sanitizeMessages(messages),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    try {
      const result = await col.insertOne(doc);
      return res.status(200).json(toListItem({ _id: result.insertedId, ...doc }));
    } catch (err) {
      console.error("conversations POST error:", err.message);
      return res.status(500).json({ error: "Could not create conversation." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
