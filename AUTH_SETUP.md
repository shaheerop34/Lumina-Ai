# Lumina AI — Login System Setup

This adds real accounts (email + password) with sessions that persist
across visits, backed by a free Supabase Postgres database. Follow
these steps once, then every deploy just works.

## 1. Create a Supabase project

1. Go to https://supabase.com → sign up / log in → **New project**.
2. Pick any name/region, set a database password (you won't need it directly).
3. Wait ~1 minute for it to finish provisioning.

## 2. Create the tables

1. In your Supabase project, open **SQL Editor** → **New query**.
2. Paste the entire contents of [`sql/schema.sql`](./sql/schema.sql) from this
   project and click **Run**.
3. You should now see three tables under **Table Editor**: `users`,
   `sessions`, `login_attempts`.

## 3. Get your API keys

1. In Supabase, go to **Project Settings → API**.
2. Copy the **Project URL** → this is `SUPABASE_URL`.
3. Copy the **service_role** key (NOT the `anon` key — the service role key
   has full database access and must stay server-side only) → this is
   `SUPABASE_SERVICE_ROLE_KEY`.

## 4. Set environment variables in Vercel

In your Vercel project → **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | from step 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 3 |
| `GROQ_API_KEY` (or `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`) | your AI provider key, as before |

Then redeploy (Vercel → Deployments → ⋯ → Redeploy), or just push a commit.

## 5. Install the new dependencies

`package.json` now lists `@supabase/supabase-js` and `bcryptjs`. Vercel
installs these automatically on deploy. If you want to test locally with
`vercel dev`, run `npm install` first.

## What you get

- **Sign up / Log in** screen in front of the chat — nobody can use the chat
  (or your AI provider key) without an account.
- **Passwords are hashed with bcrypt** (cost factor 12) — the plaintext
  password is never stored anywhere, not even briefly in a log.
- **Sessions are opaque random tokens**, not JWTs. The browser only ever
  holds the raw token (in an `httpOnly`, `Secure`, `SameSite=Lax` cookie —
  JavaScript can't read it, and it isn't sent on cross-site requests). The
  database only ever stores a **SHA-256 hash** of that token, so a database
  leak alone can't be used to forge a session.
- **Sessions persist for 30 days** ("stay logged in"), and logging out
  deletes the session server-side immediately (not just on this device).
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
  If you want it, the cleanest option is to add a Supabase Edge Function or
  a transactional email provider (Resend, Postmark) and a
  `/api/auth/request-reset` + `/api/auth/reset` pair using the same
  hashed-token pattern as sessions.
- **Per-user chat history** isn't stored server-side yet — points/streak
  still live in `localStorage` on that one browser, same as before. If you
  want chat history synced across devices, add a `messages` table keyed by
  `user_id` and load/save it from `/api/chat`.
- **Email verification** isn't required to sign up. If you want to require
  it, gate login on a `email_verified` column and send a verification link
  the same way as password reset above.
