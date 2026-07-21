// ============================================================
// Cookie helpers.
//
// The session cookie is:
//   - HttpOnly   -> JavaScript in the browser can never read it,
//                   so it can't be stolen by an XSS payload.
//   - Secure     -> only ever sent over HTTPS.
//   - SameSite=Lax -> not attached to cross-site POSTs, which is
//                   solid default CSRF protection for a cookie-based
//                   session on a single-origin app like this one.
//   - Path=/     -> sent to every route on this site.
// ============================================================

export const SESSION_COOKIE = "lumina_session";

const DAY = 24 * 60 * 60;
export const SESSION_MAX_AGE_SECONDS = 30 * DAY; // "remember me" for 30 days

export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

export function buildSessionCookie(token, maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join("; ");
}

export function buildClearedSessionCookie() {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}
