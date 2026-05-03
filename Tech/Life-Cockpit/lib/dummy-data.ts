/**
 * Dummy data switchboard.
 *
 * Phase 1 ships every module pre-populated with realistic synthetic data so
 * the user can decide what to cut by seeing it. Real data layers in later via
 * the same loader pattern.
 *
 * Usage:
 *   import { useDummyData, loadSeed } from "@/lib/dummy-data";
 *   const data = await loadSeed("health/whoop", liveLoader);
 */

export const useDummyData = (): boolean => {
  return process.env.USE_DUMMY_DATA !== "false";
};

export type LiveLoader<T> = () => Promise<T>;

/**
 * Returns dummy data when `USE_DUMMY_DATA` is on (default), otherwise calls the
 * provided live loader. If the live loader throws, falls back to dummy and logs
 * the error — defensive default for a personal cockpit.
 */
export async function loadSeed<T>(
  dummy: T,
  liveLoader?: LiveLoader<T>
): Promise<T> {
  if (useDummyData() || !liveLoader) return dummy;
  try {
    return await liveLoader();
  } catch (err) {
    console.error("Live loader failed, falling back to dummy:", err);
    return dummy;
  }
}
