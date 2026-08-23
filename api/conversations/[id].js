// Load, save, or delete ONE conversation. All operations are scoped to
// { _id: convId, userId } so a user can never read/write/delete another
// account's conversation even if they guess/forge an id.
import { ObjectId } from "mongodb";
import { getDb } from "../../lib/db.js";
import { getSessionUser } from "../../lib/session.js";
import { sanitizeMessages } from "../../lib/conversations.js";

export default async function handler(req, res) {
  const user = await getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Please log in." });
  }

  let convId;
  try {
    convId = new ObjectId(req.query.id);
  } catch (err) {
    return res.status(400).json({ error: "Invalid conversation id." });
  }

  const db = await getDb();
  const userId = new ObjectId(user.id);
  const col = db.collection("conversations");
  const scope = { _id: convId, userId };

  if (req.method === "GET") {
    try {
      const doc = await col.findOne(scope);
      if (!doc) return res.status(404).json({ error: "Conversation not found." });
      return res.status(200).json({
        conversation: {
          id: doc._id.toString(),
          title: doc.title || "New Chat",
          mode: doc.mode === "casual" ? "casual" : "coach",
          messages: doc.messages || [],
        },
      });
    } catch (err) {
      console.error("conversation GET error:", err.message);
      return res.status(500).json({ error: "Could not load conversation." });
    }
  }

  if (req.method === "POST" || req.method === "PUT") {
    const { messages, mode, title } = req.body || {};
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages must be an array." });
    }
    const update = {
      messages: sanitizeMessages(messages),
      mode: mode === "casual" ? "casual" : "coach",
      updatedAt: new Date(),
    };
    if (typeof title === "string" && title.trim()) {
      update.title = title.trim().slice(0, 60);
    }
    try {
      const result = await col.updateOne(scope, { $set: update });
      if (result.matchedCount === 0) return res.status(404).json({ error: "Conversation not found." });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("conversation PUT error:", err.message);
      return res.status(500).json({ error: "Could not save conversation." });
    }
  }

  if (req.method === "DELETE") {
    try {
      const result = await col.deleteOne(scope);
      if (result.deletedCount === 0) return res.status(404).json({ error: "Conversation not found." });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("conversation DELETE error:", err.message);
      return res.status(500).json({ error: "Could not delete conversation." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
