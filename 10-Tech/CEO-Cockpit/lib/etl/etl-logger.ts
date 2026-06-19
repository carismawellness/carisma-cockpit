function sbUrl(table: string): string {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/rest/v1/${table}`;
}

function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey:         key,
    Authorization:  `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer:         "return=representation",
  };
}

export class ETLLogger {
  private startedAt = new Date();
  private logId: number | null = null;

  constructor(private sourceName: string) {}

  async start(): Promise<void> {
    try {
      const resp = await fetch(sbUrl("etl_sync_log"), {
        method:  "POST",
        headers: sbHeaders(),
        body:    JSON.stringify({
          source_name: this.sourceName,
          started_at:  this.startedAt.toISOString(),
          status:      "running",
        }),
      });
      if (resp.ok) {
        const data = await resp.json() as { id: number }[];
        this.logId = data[0]?.id ?? null;
      }
    } catch { /* ignore logging failures */ }
  }

  async complete(rowsUpserted: number): Promise<void> {
    if (!this.logId) return;
    try {
      const now = new Date();
      await fetch(`${sbUrl("etl_sync_log")}?id=eq.${this.logId}`, {
        method:  "PATCH",
        headers: sbHeaders(),
        body:    JSON.stringify({
          completed_at:  now.toISOString(),
          status:        "success",
          rows_upserted: rowsUpserted,
          duration_sec:  +((now.getTime() - this.startedAt.getTime()) / 1000).toFixed(2),
        }),
      });
    } catch { /* ignore logging failures */ }
  }

  async fail(errorMessage: string): Promise<void> {
    if (!this.logId) return;
    try {
      const now = new Date();
      await fetch(`${sbUrl("etl_sync_log")}?id=eq.${this.logId}`, {
        method:  "PATCH",
        headers: sbHeaders(),
        body:    JSON.stringify({
          completed_at:  now.toISOString(),
          status:        "failed",
          error_message: errorMessage.slice(0, 500),
          duration_sec:  +((now.getTime() - this.startedAt.getTime()) / 1000).toFixed(2),
        }),
      });
    } catch { /* ignore logging failures */ }
  }
}
