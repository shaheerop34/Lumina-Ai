// ============================================================
// Server-only MongoDB connection.
//
// This connects with a normal (non-admin) database user and must
// NEVER be sent to the browser — it only ever runs inside these
// /api serverless functions. Set MONGODB_URI in Vercel → Project →
// Settings → Environment Variables (see AUTH_SETUP.md).
//
// The client is cached on `global` so repeat invocations of the same
// warm serverless instance reuse one connection pool instead of
// opening a new one per request.
// ============================================================

import { MongoClient } from "mongodb";

const DB_NAME = process.env.MONGODB_DB || "lumina";

let indexesEnsured = false;

function getClientPromise() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "Missing MONGODB_URI environment variable. See AUTH_SETUP.md for setup instructions."
    );
  }

  if (!global._luminaMongoClientPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 5, // keep small — serverless functions don't need a big pool
    });
    global._luminaMongoClientPromise = client.connect();
  }
  return global._luminaMongoClientPromise;
}

async function ensureIndexes(db) {
  if (indexesEnsured) return;
  indexesEnsured = true; // set eagerly so concurrent calls don't all race to create the same indexes

  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ userId: 1 }),
    // TTL index: MongoDB automatically deletes expired sessions for us.
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("loginAttempts").createIndex({ email: 1, createdAt: -1 }),
    db.collection("loginAttempts").createIndex({ ip: 1, createdAt: -1 }),
    // Old failed-login records aren't needed once they age out of the
    // rate-limit window; this keeps the collection from growing forever.
    db.collection("loginAttempts").createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 }),
  ]).catch((err) => {
    // Don't crash requests over index creation races/permissions —
    // just log it so it's visible in Vercel's function logs.
    console.error("ensureIndexes error:", err.message);
  });
}

export async function getDb() {
  const client = await getClientPromise();
  const db = client.db(DB_NAME);
  await ensureIndexes(db);
  return db;
}
