import { redirect } from "next/navigation";

/**
 * The legacy /finance page rendered hardcoded MOCK_* data.
 * It now permanently forwards to the live EBITDA dashboard.
 */
export default function FinancePage() {
  redirect("/finance/ebitda-v2");
}
