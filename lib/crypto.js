// ============================================================
// Password hashing + session token helpers.
//
// - Passwords are hashed with bcrypt (cost factor 12). We never
//   store or log plaintext passwords.
// - Session tokens are cryptographically random (32 bytes). We give
//   the RAW token to the browser (in an httpOnly cookie) but only
//   ever store its SHA-256 HASH in the database. This means a leak
//   of the database can never be used to forge a valid session.
// ============================================================

import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";

const BCRYPT_COST = 12;

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, BCRYPT_COST);
}

export async function verifyPassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

export function generateSessionToken() {
  return randomBytes(32).toString("hex"); // 256 bits of entropy
}

export function hashToken(rawToken) {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function isValidEmail(email) {
  return typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Minimum bar: 8+ chars. We deliberately don't demand a specific mix
// of character classes — length matters far more than complexity
// rules, and those rules push people toward reused, predictable passwords.
export function isValidPassword(password) {
  return typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 256;
}
