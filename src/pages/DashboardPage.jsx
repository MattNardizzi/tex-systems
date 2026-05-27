import Dashboard from "../components/Dashboard/Dashboard";

/**
 * DashboardPage — the only page in the product.
 *
 * The vigil is the product. There is no other state to manage at
 * this level. Data integration with the backend (the real
 * decisions, the real ledger positions, the real hashes) lives
 * inside Vigil's data layer, not here.
 */
export default function DashboardPage() {
  return <Dashboard initial="M" />;
}
