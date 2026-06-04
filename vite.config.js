import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * In production the same-origin path `/api/tex/*` is served by the Vercel
 * serverless proxy (`api/tex/[...path].js`), which attaches the key and
 * forwards to the backend. Vite has no serverless functions, so in `npm run
 * dev` we proxy that same path to a locally running backend instead.
 *
 * To see "Yes → mapping" hit the real discovery pipeline against the
 * simulator, boot the backend in sandbox mode first:
 *
 *     TEX_SANDBOX=1 uvicorn tex.main:app --port 8000
 *
 * then `npm run dev`. Override the target with VITE_TEX_BACKEND if your
 * backend runs elsewhere. The rewrite strips the `/api/tex` prefix exactly
 * as the Vercel proxy does, so `/api/tex/v1/foo` → `<backend>/v1/foo`.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backend = env.VITE_TEX_BACKEND || "http://localhost:8000";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api/tex": {
          target: backend,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/tex/, ""),
        },
      },
    },
  };
});
