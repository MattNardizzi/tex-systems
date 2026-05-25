/**
 * texApi.js
 *
 * Frontend client for the Tex backend on Render.
 *
 * Set VITE_TEX_API_BASE in Vercel → Settings → Environment Variables
 *   e.g.  https://tex-api.onrender.com
 *
 * When VITE_TEX_API_BASE is unset, the hook in useExecutionData.js
 * falls back to mock data so the app still renders.
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

export const getCurrentFocus = () => request("/api/execution/focus");
export const getExecutionStats = () => request("/api/execution/stats");
export const showEvidence = (id) => request(`/api/execution/${id}/evidence`);
export const acknowledgeDecision = (id) =>
  request(`/api/execution/${id}/ack`, { method: "POST" });
export const askTex = (text) =>
  request("/api/tex/ask", { method: "POST", body: JSON.stringify({ text }) });
