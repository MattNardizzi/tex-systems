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
 * CORS surface. Node.js runtime on Fluid compute (the Vercel default; the
 * Edge runtime was folded into Vercel Functions on 2025-06-25). Written to
 * the current Web-standard `fetch` handler signature, and streaming-ready:
 * the upstream body is piped through untouched, so when the backend grows a
 * `text/event-stream` endpoint (the SSE voice-push), this same proxy carries
 * it with no change — only the interface switches from polling to EventSource.
 *
 * ROUTING: a single plain function, NOT a `[...path]` catch-all. On a
 * non-Next project Vercel only routes a catch-all's *single*-segment paths,
 * so `/api/tex/v1/vigil` (and every real endpoint) 404'd at the edge. Instead
 * `vercel.json` rewrites `/api/tex/:path*` (any depth) to
 * `/api/tex/proxy?__path=:path*`, and this function reads `__path` to rebuild
 * the upstream path. A direct hit (no rewrite) falls back to stripping the
 * `/api/tex` prefix from the pathname.
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
 * `/api/tex/v1/vigil?tenant_id=acme` forwards verbatim to
 * `${TEX_API_BASE}/v1/vigil?tenant_id=acme`.
 */

const DEFAULT_BASE = "https://tex-uh4j.onrender.com";
const PREFIX = "/api/tex";

export default {
  async fetch(request) {
    const base = (process.env.TEX_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
    const key = process.env.TEX_API_KEY;

    const url = new URL(request.url);

    // The rewrite injects the upstream path as `__path` (one value joined by
    // "/", or repeated values — handle both). Fall back to stripping the
    // /api/tex prefix from the pathname for a direct, un-rewritten hit.
    let tail = url.searchParams.getAll("__path").join("/");
    if (!tail) {
      const i = url.pathname.indexOf(PREFIX);
      tail = i === -1 ? url.pathname : url.pathname.slice(i + PREFIX.length);
    }
    tail = "/" + tail.replace(/^\/+/, ""); // exactly one leading slash ("/" if empty)

    // Forward the original query, minus our internal routing param.
    const params = new URLSearchParams(url.search);
    params.delete("__path");
    const qs = params.toString();
    const upstreamUrl = `${base}${tail === "/" ? "" : tail}${qs ? `?${qs}` : ""}`;

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
