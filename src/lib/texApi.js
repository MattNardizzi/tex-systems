/**
 * texApi.js
 *
 * Frontend client for the Tex backend on Render.
 *
 * Set VITE_TEX_API_BASE in Vercel → Settings → Environment Variables
 *   e.g.  https://tex-api.onrender.com
 */

const BASE = import.meta.env.VITE_TEX_API_BASE || "";

async function request(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tex API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

/** Pull the current decision that needs human attention (the one shown on the card). */
export const getCurrentFocus = () => request("/api/execution/focus");

/** Pull hour stats for the header. */
export const getExecutionStats = () => request("/api/execution/stats");

/** User tapped "Show me" — open the evidence pane. */
export const showEvidence = (decisionId) =>
  request(`/api/execution/${decisionId}/evidence`);

/** User tapped "Thank you" — acknowledge and dismiss. */
export const acknowledgeDecision = (decisionId) =>
  request(`/api/execution/${decisionId}/ack`, { method: "POST" });

/** Ask Tex anything — natural-language bar. */
export const askTex = (text) =>
  request("/api/tex/ask", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
