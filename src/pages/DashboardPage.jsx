import Dashboard from "../components/Dashboard/Dashboard";
import { useExecutionData } from "../hooks/useExecutionData";

/**
 * DashboardPage — the only page in the product (for now).
 *
 * In production, the hook reads from the FastAPI backend. With no
 * VITE_TEX_API_BASE set, it returns a mock decision so the AsksYou
 * state renders out of the box.
 *
 * A tiny dev toggle in the bottom-left lets you flip between the two
 * states without backend wiring. Hidden in production.
 */
export default function DashboardPage() {
  const { decision, onShowMe, onThanks, onAsk, dismiss, restore } =
    useExecutionData();

  const isDev = import.meta.env.DEV;
  const asking = !!decision;

  const handleThanks = () => {
    onThanks();
    dismiss();
  };

  return (
    <>
      <Dashboard
        decision={decision}
        initial="M"
        onShowMe={onShowMe}
        onThanks={handleThanks}
        onOpenRoom={(key) => console.log("[dev] open room:", key)}
      />

      {isDev && (
        <div className="tex-dev-toggle">
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
