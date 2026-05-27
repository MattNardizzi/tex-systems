import { useEffect, useState } from "react";
import Dashboard from "../components/Dashboard/Dashboard";
import { useExecutionData } from "../hooks/useExecutionData";

/**
 * DashboardPage — the only page in the product (for now).
 *
 * In production, the hook reads from the FastAPI backend. With no
 * VITE_TEX_API_BASE set, it returns a mock decision so the AsksYou
 * state renders out of the box.
 *
 * The dev toggle does not exist in the DOM at rest. It is summoned
 * with ⌘. or Ctrl+. and dismissed with Escape. A button living
 * permanently in the corner of a shipping product is a confession
 * that the product isn't finished. We don't ship the confession.
 */
export default function DashboardPage() {
  const {
    decision,
    pendingLearnings,
    onShowMe,
    onThanks,
    onAsk,
    dismiss,
    restore,
  } = useExecutionData();

  const isDev = import.meta.env.DEV;
  const asking = !!decision;

  // Hidden dev panel — summon with ⌘./Ctrl+., dismiss with Escape.
  const [devOpen, setDevOpen] = useState(false);

  useEffect(() => {
    if (!isDev) return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setDevOpen((v) => !v);
      } else if (e.key === "Escape" && devOpen) {
        setDevOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDev, devOpen]);

  const handleThanks = () => {
    onThanks();
    dismiss();
  };

  return (
    <>
      <Dashboard
        decision={decision}
        pendingLearnings={pendingLearnings}
        initial="M"
        onShowMe={onShowMe}
        onThanks={handleThanks}
        onOpenRoom={(key) => console.log("[dev] open room:", key)}
      />

      {isDev && devOpen && (
        <div className="tex-dev-toggle" role="dialog" aria-label="Dev">
          <button
            type="button"
            onClick={() => (asking ? dismiss() : restore())}
          >
            {asking ? "Quiet" : "Asking"}
          </button>
        </div>
      )}
    </>
  );
}
