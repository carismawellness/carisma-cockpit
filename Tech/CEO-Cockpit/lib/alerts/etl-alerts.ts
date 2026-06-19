/**
 * ETL failure alerting — sends ONE consolidated email per cron run.
 *
 * Mirrors the Resend mechanism used by app/api/ci/notify/route.ts (plain
 * fetch to https://api.resend.com/emails with RESEND_API_KEY) but is called
 * directly from server code — no HTTP hop through the notify route.
 *
 * Env vars:
 *   RESEND_API_KEY — required for delivery (same as ci/notify)
 *   ALERT_EMAIL    — recipient; falls back to CEO_EMAIL (ci/notify's default)
 *   RESEND_FROM    — sender; falls back to "ci@carisma.com" (ci/notify's default)
 *
 * Alerting must NEVER break the cron: this function catches everything and
 * only ever logs on failure.
 */

export interface EtlFailure {
  source: string;
  error:  string;
}

export interface AlertResult {
  sent:    boolean;
  reason?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendEtlFailureAlert(failures: EtlFailure[]): Promise<AlertResult> {
  try {
    if (!failures.length) return { sent: false, reason: "no failures" };

    const recipient = process.env.ALERT_EMAIL || process.env.CEO_EMAIL;
    const apiKey    = process.env.RESEND_API_KEY;

    if (!apiKey || !recipient) {
      // Loud log, never throw — the cron must continue.
      console.error(
        `[ETL Alert] CANNOT SEND ALERT EMAIL — ${!apiKey ? "RESEND_API_KEY missing" : ""}` +
        `${!apiKey && !recipient ? " and " : ""}${!recipient ? "ALERT_EMAIL/CEO_EMAIL missing" : ""}. ` +
        `${failures.length} ETL failure(s) went unreported by email:`,
        failures.map(f => `${f.source}: ${f.error}`).join(" | ")
      );
      return { sent: false, reason: "email not configured" };
    }

    const ts = new Date().toISOString();
    const rows = failures
      .map(
        (f) =>
          `<tr>
            <td style="padding:8px;border:1px solid #ddd;font-weight:bold;">${escapeHtml(f.source)}</td>
            <td style="padding:8px;border:1px solid #ddd;color:#dc2626;">${escapeHtml(f.error.slice(0, 500))}</td>
          </tr>`
      )
      .join("");

    const htmlBody = `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
        <h2 style="color:#dc2626;">CEO Cockpit — ETL Failure${failures.length > 1 ? "s" : ""}</h2>
        <p>${failures.length} data source${failures.length > 1 ? "s" : ""} failed during the nightly refresh at <strong>${ts}</strong>.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Source</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Error</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#6b7280;font-size:12px;">
          Review sync status and re-trigger sources at <strong>/settings/data-sources</strong> in the CEO Cockpit.<br/>
          Common cause: expired OAuth refresh token (look for <code>invalid_grant</code> in the error).
        </p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    process.env.RESEND_FROM || "ci@carisma.com",
        to:      recipient,
        subject: `[ETL FAILURE] ${failures.length} source${failures.length > 1 ? "s" : ""} failed — CEO Cockpit nightly refresh`,
        html:    htmlBody,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[ETL Alert] Resend API error (${res.status}):`, errText.slice(0, 500));
      return { sent: false, reason: `Resend HTTP ${res.status}` };
    }

    console.log(`[ETL Alert] Failure alert sent to ${recipient} (${failures.length} failure(s))`);
    return { sent: true };
  } catch (err) {
    console.error("[ETL Alert] Unexpected error while sending alert:", err);
    return { sent: false, reason: String(err) };
  }
}
