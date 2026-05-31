/**
 * /api/tex/* — the wire between tex.systems (Vercel) and Tex (Render).
 *
 * This is the ONLY path the browser uses to reach the backend. The
 * browser never speaks to Render directly, and the Render API key never
 * ships inside the client bundle. The browser asks Vercel; this function
 * (holding the key in a server-side env var) asks Tex; Tex answers; the
 * browser renders what Tex chose.
 *
 * One hop, one secret, never in the client. Same-origin, so there is no
 * CORS surface. Node.js runtime (the Vercel default; the Edge runtime was
 * deprecated April 2026). Written to the current Web-standard `fetch`
 * handler signature, and streaming-ready: the upstream body is piped
 * through untouched, so when the backend grows a `text/event-stream`
 * endpoint (the SSE voice-push), this same proxy carries it with no
 * change — only the interface switches from polling to EventSource.
 *
 * Env (set in the Vercel project, NOT in the bundle):
 *   TEX_API_BASE  — backend origin. Defaults to the live Render deploy.
 *   TEX_API_KEY   — optional. When present, sent as `Authorization:
 *                   Bearer <key>`. When absent, no auth header is sent and
 *                   a keyless (anonymous) backend serves the request — the
 *                   current dev posture. The key must carry `decision:read`
 *                   for /v1/vigil and additionally `evidence:read` for
 *                   /v1/vigil/explain.
 *
 * Catch-all: `/api/tex/v1/vigil?tenant_id=acme` forwards verbatim to
 * `${TEX_API_BASE}/v1/vigil?tenant_id=acme`.
 */

const DEFAULT_BASE = "https://tex-uh4j.onrender.com";
const PREFIX = "/api/tex";

export default {
  async fetch(request) {
    const base = (process.env.TEX_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
    const key = process.env.TEX_API_KEY;

    // Forward the path + query that follow the /api/tex prefix, verbatim.
    const url = new URL(request.url);
    const i = url.pathname.indexOf(PREFIX);
    const tail =
      i === -1 ? url.pathname : url.pathname.slice(i + PREFIX.length) || "/";
    const upstreamUrl = `${base}${tail}${url.search}`;

    const headers = { "Content-Type": "application/json" };
    if (key) headers["Authorization"] = `Bearer ${key}`;

    const init = { method: request.method, headers };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.text();
    }

    try {
      const upstream = await fetch(upstreamUrl, init);
      // Pipe the body through untouched (works for JSON now, SSE later).
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type":
            upstream.headers.get("content-type") || "application/json",
          // The vigil is a live read. Never cache the voice.
          "Cache-Control": "no-store",
        },
      });
    } catch (_err) {
      // Silence is Tex's failure mode. Surface a clean 502; the hook keeps
      // the last good truth and the vigil keeps speaking it.
      return new Response(
        JSON.stringify({ error: "tex backend unreachable" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};
