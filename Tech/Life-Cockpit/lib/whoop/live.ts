/**
 * WHOOP live-data adapter. Returns null in Phase 1 — the WHOOP TypeScript
 * client is not yet built. The Health → WHOOP page falls back to dummy data
 * automatically via `loadSeed()`.
 *
 * Phase 2 plan: implement OAuth refresh + paginated v2 API calls here, mirroring
 * the existing Python implementation in `Tools/whoop/`. For now this is a stub
 * so the import compiles.
 */

import type { WhoopSeed } from "@/lib/seed/health/whoop";

export async function fetchWhoopLive(): Promise<WhoopSeed> {
  if (!process.env.WHOOP_CLIENT_ID || !process.env.WHOOP_CLIENT_SECRET) {
    throw new Error("WHOOP credentials not configured");
  }
  // TODO Phase 2: implement WHOOP API v2 client (port from Tools/whoop/client.py)
  throw new Error("WHOOP live client not implemented yet — Phase 2");
}
