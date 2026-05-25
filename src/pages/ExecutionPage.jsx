import ExecutionRoom from "../components/Execution/ExecutionRoom";
import { useExecutionData } from "../hooks/useExecutionData";

export default function ExecutionPage() {
  const { decision, stats, onShowMe, onThanks, onAsk } = useExecutionData();

  return (
    <ExecutionRoom
      decision={decision}
      stats={stats}
      onShowMe={onShowMe}
      onThanks={onThanks}
      onAsk={onAsk}
      activeLayer="execution"
    />
  );
}
