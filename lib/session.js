import { ObjectId } from "mongodb";
import { getDb } from "./db.js";
import { hashToken } from "./crypto.js";
import { parseCookies, SESSION_COOKIE } from "./cookies.js";

// Resolves the current request's session cookie to a user, checking
// expiry server-side. Returns null if there's no valid session —
// callers decide whether that's an error (protected routes) or fine.
export async function getSessionUser(req) {
  const cookies = parseCookies(req);
  const rawToken = cookies[SESSION_COOKIE];
  if (!rawToken) return null;

  const db = await getDb();
  const tokenHash = hashToken(rawToken);

  const session = await db.collection("sessions").findOne({ tokenHash });
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;

  const user = await db.collection("users").findOne(
    { _id: session.userId },
    { projection: { passwordHash: 0 } } // never pull the password hash out
  );
  if (!user) return null;

  return { id: user._id.toString(), email: user.email, displayName: user.displayName || null };
}

export { ObjectId };
