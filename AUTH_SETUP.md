# Lumina AI — Login System Setup (MongoDB)

This adds real accounts (email + password) with sessions that persist
across visits, plus cross-device chat history — all backed by a free
MongoDB Atlas database. Follow these steps once, then every deploy
just works.

## 1. Create a free MongoDB Atlas cluster

1. Go to https://www.mongodb.com/cloud/atlas/register → sign up (free).
2. Click **Build a Database** → choose the **M0 Free** tier → pick any
   cloud provider/region → **Create**.
3. Wait ~1–3 minutes for the cluster to finish provisioning.

## 2. Create a database user

1. When prompted (or under **Database Access** in the left sidebar),
   click **Add New Database User**.
2. Choose **Password** auth, set a username and a strong password
   (save it somewhere — you'll need it in step 4).
3. Give it **Read and write to any database** (the default "Atlas
   admin" built-in role is fine for this project).

## 3. Allow network access

1. Go to **Network Access** in the left sidebar → **Add IP Address**.
2. Click **Allow Access From Anywhere** (`0.0.0.0/0`).
   Vercel's serverless functions run from rotating IPs, so a fixed IP
   allowlist won't work here. Your database is still protected by the
   username/password from step 2 — just make sure that password is
   strong and never committed to git.

## 4. Get your connection string

1. Go to **Database** → your cluster → **Connect** → **Drivers**.
2. Copy the connection string. It looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
3. Replace `<username>` and `<password>` with the database user you
   created in step 2 (URL-encode the password if it has special
   characters like `@` or `/`).

## 5. Set environment variables in Vercel

In your Vercel project → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `MONGODB_URI` | the connection string from step 4 |
| `MONGODB_DB` | `lumina` (optional — this is the default if you skip it) |
| `GROQ_API_KEY` (or `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`) | your AI provider key, as before |

Then redeploy (Vercel → Deployments → ⋯ → Redeploy), or just push a commit.

## 6. Install the new dependency

`package.json` now lists `mongodb` and `bcryptjs`. Vercel installs these
automatically on deploy. If you want to test locally with `vercel dev`,
run `npm install` first.

## Collections (created automatically — nothing to run by hand)

Unlike a SQL database, MongoDB doesn't need a schema migration. The
first time the app runs, it automatically creates these collections
and indexes for you (see `lib/db.js` → `ensureIndexes`):

| Collection | Purpose |
|---|---|
| `users` | email (unique), bcrypt password hash, display name |
| `sessions` | hashed session tokens, auto-expire via a MongoDB TTL index |
| `loginAttempts` | brute-force tracking, auto-deleted after 1 hour |
| `chatState` | one document per user: their saved chat history, points, streak, mode |

If you ever want to inspect the data, use **Atlas → Browse Collections**
in the dashboard, or connect with `mongosh "<your connection string>"`.

## What you get

- **Sign up / Log in** screen in front of the chat — nobody can use the chat
  (or your AI provider key) without an account.
- **Cross-device chat history**: your conversation, points, streak, and
  mode are saved to MongoDB after every exchange and restored on any
  device you log into (see `api/chat-state.js`).
- **Passwords are hashed with bcrypt** (cost factor 12) — the plaintext
  password is never stored anywhere, not even briefly in a log.
- **Sessions are opaque random tokens**, not JWTs. The browser only ever
  holds the raw token (in an `httpOnly`, `Secure`, `SameSite=Lax` cookie —
  JavaScript can't read it, and it isn't sent on cross-site requests). The
  database only ever stores a **SHA-256 hash** of that token, so a database
  leak alone can't be used to forge a session.
- **Sessions persist for 30 days** ("stay logged in"), and logging out
  deletes the session server-side immediately (not just on this device).
  Expired sessions are also cleaned up automatically by a MongoDB TTL index.
- **Brute-force protection**: after 5 failed logins for the same email (or
  20 for the same IP) within 15 minutes, further attempts are rejected with
  a 429 until the window passes.
- **No user enumeration**: login failures always say "Invalid email or
  password" (never "no such user"), and take the same amount of time
  whether the email exists or not.
- The `/api/chat` proxy itself now checks for a valid session before calling
  your AI provider, so the key can't be used by someone who just finds the
  URL.

## Notes / things you may want to extend later

- **Password reset** isn't included yet (there's no email-sending set up).
  If you want it, add a transactional email provider (Resend, Postmark)
  and a `/api/auth/request-reset` + `/api/auth/reset` pair using the same
  hashed-token pattern as sessions.
- **Email verification** isn't required to sign up. If you want to require
  it, add an `emailVerified: false` field on the user document and gate
  login on it, sending a verification link the same way as password reset
  above.
