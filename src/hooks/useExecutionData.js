import { useEffect, useState } from "react";
import {
  getCurrentFocus,
  getExecutionStats,
  showEvidence,
  acknowledgeDecision,
  askTex,
} from "../lib/texApi";

const MOCK_FOCUS = {
  id: "c447f14b",
  summary: "Kestrel asked to wire fifty thousand dollars in your CEO's name.",
  aside: "I said no.",
  badge: "stopped",
  timestamp: "2026-05-25T07:51:21Z",
};

const MOCK_STATS = { decisionsThisHour: 4827, needsYou: 1 };

/**
 * useExecutionData
 *
 * Reads the current focus + stats from the backend, with a mock fallback
 * when VITE_TEX_API_BASE is unset.
 *
 * Default first-load state is QUIET (decision = null). Use the dev toggle
 * in the bottom-left to flip to the asking state with the mock decision.
 *
 * Exposes:
 *   - decision, stats, loading
 *   - onShowMe()   open evidence for the current decision
 *   - onThanks()   ack the current decision on the backend
 *   - onAsk(text)  send a natural-language question
 *   - dismiss()    clear decision locally (returns canvas to AllQuiet)
 *   - restore()    re-show the last seen decision (dev helper)
 */
export function useExecutionData() {
  const [decision, setDecision] = useState(null);
  const [lastSeen, setLastSeen] = useState(MOCK_FOCUS);
  const [stats, setStats] = useState(MOCK_STATS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!import.meta.env.VITE_TEX_API_BASE) return;
    let cancelled = false;
    setLoading(true);

    Promise.allSettled([getCurrentFocus(), getExecutionStats()])
      .then(([focusRes, statsRes]) => {
        if (cancelled) return;
        if (focusRes.status === "fulfilled") {
          setDecision(focusRes.value);
          setLastSeen(focusRes.value);
        }
        if (statsRes.status === "fulfilled") setStats(statsRes.value);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, []);

  const onShowMe = async () => {
    if (!decision) return;
    if (!import.meta.env.VITE_TEX_API_BASE) {
      console.log("[mock] Show me →", decision.id);
      return;
    }
    try {
      const evidence = await showEvidence(decision.id);
      window.dispatchEvent(
        new CustomEvent("tex:evidence", { detail: evidence })
      );
    } catch (err) {
      console.error(err);
    }
  };

  const onThanks = async () => {
    if (!decision) return;
    if (!import.meta.env.VITE_TEX_API_BASE) {
      console.log("[mock] Thank you →", decision.id);
      return;
    }
    try {
      await acknowledgeDecision(decision.id);
    } catch (err) {
      console.error(err);
    }
  };

  const onAsk = async (text) => {
    if (!import.meta.env.VITE_TEX_API_BASE) {
      console.log("[mock] Ask Tex →", text);
      return;
    }
    try {
      const reply = await askTex(text);
      window.dispatchEvent(new CustomEvent("tex:reply", { detail: reply }));
    } catch (err) {
      console.error(err);
    }
  };

  const dismiss = () => setDecision(null);
  const restore = () => setDecision(lastSeen);

  return {
    decision,
    stats,
    loading,
    onShowMe,
    onThanks,
    onAsk,
    dismiss,
    restore,
  };
}
