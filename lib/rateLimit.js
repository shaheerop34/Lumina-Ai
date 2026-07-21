// ============================================================
// Brute-force protection for /api/auth/login.
//
// We log every attempt (success or failure) to the loginAttempts
// collection, then before processing a new attempt we check: has this
// email OR this IP failed too many times in the last window? If so,
// we reject the request with 429 before even checking the password.
// ============================================================

import { getDb } from "./db.js";

const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

export function getClientIp(req) {
  const fwd = req.headers?.["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

export async function isLockedOut(email, ip) {
  const db = await getDb();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const attempts = db.collection("loginAttempts");

  const emailFailures = await attempts.countDocuments({
    email,
    success: false,
    createdAt: { $gte: since },
  });
  if (emailFailures >= MAX_FAILURES_PER_EMAIL) {
    return { locked: true, reason: "email" };
  }

  const ipFailures = await attempts.countDocuments({
    ip,
    success: false,
    createdAt: { $gte: since },
  });
  if (ipFailures >= MAX_FAILURES_PER_IP) {
    return { locked: true, reason: "ip" };
  }

  return { locked: false };
}

export async function recordAttempt(email, ip, success) {
  const db = await getDb();
  await db.collection("loginAttempts").insertOne({ email, ip, success, createdAt: new Date() });
}
