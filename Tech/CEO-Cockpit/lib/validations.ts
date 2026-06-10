import { z } from "zod";

export const auditSchema = z.object({
  action: z.string().min(1),
  page: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const notifySchema = z.object({
  alerts: z.array(
    z.object({
      metric: z.string(),
      value: z.number(),
      target: z.number().optional(),
      department: z.string(),
      severity: z.string(),
      message: z.string(),
    })
  ),
  recipientEmail: z.string().email().optional(),
});

// --- Rate Limiter ---

const rateLimiter = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

export function checkRateLimit(
  userId: string,
  limit: number
): boolean {
  const now = Date.now();
  const key = `${userId}`;
  const entry = rateLimiter.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimiter.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}
