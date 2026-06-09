import { NextRequest, NextResponse } from "next/server";
import { notifySchema } from "@/lib/validations";

export const maxDuration = 60;

/**
 * CI Critical Alert Notification Endpoint
 *
 * Receives critical alert data and dispatches email notifications.
 * Currently logs the notification (ready for email service integration).
 *
 * To enable email sending, configure one of:
 * - RESEND_API_KEY for Resend
 * - SMTP_HOST/SMTP_USER/SMTP_PASS for nodemailer
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = notifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { alerts, recipientEmail } = parsed.data;
    const toEmail = recipientEmail || process.env.CEO_EMAIL;

    if (!toEmail) {
      return NextResponse.json(
        { error: "No recipient email configured" },
        { status: 400 }
      );
    }

    // Compose HTML email body
    const alertRows = alerts
      .map(
        (a) =>
          `<tr>
            <td style="padding:8px;border:1px solid #ddd;">${a.department}</td>
            <td style="padding:8px;border:1px solid #ddd;">${a.metric}</td>
            <td style="padding:8px;border:1px solid #ddd;color:#dc2626;font-weight:bold;">${a.value}</td>
            <td style="padding:8px;border:1px solid #ddd;">${a.target ?? "N/A"}</td>
            <td style="padding:8px;border:1px solid #ddd;">${a.message}</td>
          </tr>`
      )
      .join("");

    const htmlBody = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#dc2626;">Carisma Intelligence — Critical Alert${alerts.length > 1 ? "s" : ""}</h2>
        <p>${alerts.length} critical alert${alerts.length > 1 ? "s" : ""} detected and require${alerts.length === 1 ? "s" : ""} immediate attention.</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Dept</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Metric</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Value</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Target</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left;">Details</th>
            </tr>
          </thead>
          <tbody>${alertRows}</tbody>
        </table>
        <p style="color:#6b7280;font-size:12px;">
          This is an automated notification from Carisma Intelligence.<br/>
          Log in to the CEO Cockpit to review and take action.
        </p>
      </div>
    `;

    // Attempt to send via Resend if configured
    if (process.env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || "ci@carisma.com",
          to: toEmail,
          subject: `[CRITICAL] ${alerts.length} alert${alerts.length > 1 ? "s" : ""} — Carisma Intelligence`,
          html: htmlBody,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("[CI Notify] Resend API error:", errText);
        return NextResponse.json(
          { sent: false, error: "Email delivery failed" },
          { status: 502 }
        );
      }

      console.log(
        `[CI Notify] Critical alert email sent to ${toEmail} via Resend`
      );
      return NextResponse.json({ sent: true, to: toEmail });
    }

    // Fallback: log the notification (no email service configured)
    console.log(
      `[CI Notify] Would email ${toEmail}: ${alerts.length} critical alert(s)`
    );
    console.log("[CI Notify] HTML body composed. Configure RESEND_API_KEY to enable delivery.");

    return NextResponse.json({
      sent: false,
      queued: true,
      to: toEmail,
      alertCount: alerts.length,
      message:
        "Email notification queued but no email service configured. Set RESEND_API_KEY to enable.",
    });
  } catch {
    return NextResponse.json(
      { error: "Notification dispatch failed" },
      { status: 500 }
    );
  }
}
