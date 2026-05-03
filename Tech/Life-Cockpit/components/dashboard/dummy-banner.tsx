/**
 * Persistent banner shown across all pages while USE_DUMMY_DATA is on.
 * Reminds the user that what they see is seed data, not real life.
 */

import { useDummyData } from "@/lib/dummy-data";

export function DummyBanner() {
  if (!useDummyData()) return null;
  return (
    <div className="bg-amber-100 border-b border-amber-200 px-4 py-1.5 text-center text-[11px] font-medium text-amber-900 tracking-wide uppercase">
      Sample data — flip <code className="bg-amber-200 px-1 rounded">USE_DUMMY_DATA=false</code> in env to wire real sources
    </div>
  );
}
