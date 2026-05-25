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

export function useExecutionData() {
  const [decision, setDecision] = useState(MOCK_FOCUS);
  const [stats, setStats] = useState(MOCK_STATS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!import.meta.env.VITE_TEX_API_BASE) return;
    let cancelled = false;
    setLoading(true);

    Promise.allSettled([getCurrentFocus(), getExecutionStats()])
      .then(([focusRes, statsRes]) => {
        if (cancelled) return;
        if (focusRes.status === "fulfilled") setDecision(focusRes.value);
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
      window.dispatchEvent(new CustomEvent("tex:evidence", { detail: evidence }));
    } catch (err) {
      console.error(err);
    }
  };

  const onThanks = async () => {
    if (!decision) return;
    if (!import.meta.env.VITE_TEX_API_BASE) {
      console.log("[mock] Thank you →", decision.id);
      setDecision(null);
      return;
    }
    try {
      await acknowledgeDecision(decision.id);
      setDecision(null);
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

  return { decision, stats, loading, onShowMe, onThanks, onAsk };
}
