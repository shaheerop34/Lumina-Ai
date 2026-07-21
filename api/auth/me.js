import { getSessionUser } from "../../lib/session.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getSessionUser(req);
    if (!user) {
      return res.status(401).json({ user: null });
    }
    return res.status(200).json({ user });
  } catch (err) {
    console.error("me error:", err.message);
    return res.status(500).json({ error: "Could not check session." });
  }
}
