// Shared between api/conversations.js (list/create) and
// api/conversations/[id].js (load/save/delete one) so both enforce the
// exact same shape/size caps on stored message history.

export const MAX_MESSAGES = 200; // keep payloads reasonable; oldest history is trimmed

export function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) }));
}
