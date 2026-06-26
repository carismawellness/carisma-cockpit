import { NextRequest, NextResponse } from "next/server";

// One-time fix: insert 3 missing May 2026 Car-Fuel (account 611151) expense rows
// into transactions_raw and correct spa_ebitda_daily SGA amounts for those dates.
//
// Missing expenses (confirmed via Zoho API, absent after full May re-sync):
//   128265000029309134  2026-05-22  €46.00  V.C Service Station
//   128265000029294849  2026-05-19  €45.00  Kappara Service Station
//   128265000029186704  2026-05-09  €19.00  V.C Service Station
//
// Each is split equally across 8 SPA venues (split_rule_id=4 = "equal").

const MISSING: Array<{
  txn_id: string; date: string; amount: number; contact_name: string;
}> = [
  { txn_id: "128265000029309134", date: "2026-05-22", amount: 46,   contact_name: "V.C Service Station"       },
  { txn_id: "128265000029294849", date: "2026-05-19", amount: 45,   contact_name: "Kappara Service Station"   },
  { txn_id: "128265000029186704", date: "2026-05-09", amount: 19,   contact_name: "V.C Service Station"       },
];

const VENUES: Array<{ slug: string; location_id: number }> = [
  { slug: "intercontinental", location_id: 1 },
  { slug: "hugos",            location_id: 2 },
  { slug: "hyatt",            location_id: 3 },
  { slug: "ramla",            location_id: 4 },
  { slug: "labranda",         location_id: 5 },
  { slug: "sunny_coast",      location_id: 6 },
  { slug: "excelsior",        location_id: 7 },
  { slug: "novotel",          location_id: 8 },
];

function sbUrl(table: string): string {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/rest/v1/${table}`;
}
function sbHeaders(prefer?: string): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey: key, Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (!body.confirm) {
      return NextResponse.json({
        message: "POST with {confirm: true} to apply the fix",
        preview: MISSING.map(e => ({
          txn_id: e.txn_id, date: e.date, amount: e.amount,
          contact_name: e.contact_name,
          per_venue: +(e.amount / 8).toFixed(2),
        })),
      });
    }

    const now = new Date().toISOString();
    const rawRows: Record<string, unknown>[] = [];
    // Map date → per-venue sga increment for spa_ebitda_daily update
    const sgaDelta: Map<string, number> = new Map();

    for (const e of MISSING) {
      const perVenue = +(e.amount / 8).toFixed(2);
      sgaDelta.set(e.date, (sgaDelta.get(e.date) ?? 0) + perVenue);
      for (const v of VENUES) {
        rawRows.push({
          org:              "spa",
          txn_id:           e.txn_id,
          date:             e.date,
          ebitda_line:      "sga",
          ebitda_sub_line:  "fuel",
          account_code:     "611151",
          account_name:     "Car - Fuel",
          contact_name:     e.contact_name,
          transaction_type: "expense",
          venue:            v.slug,
          amount:           perVenue,
          synced_at:        now,
        });
      }
    }

    // 1. Upsert into transactions_raw
    const rawResp = await fetch(sbUrl("transactions_raw"), {
      method: "POST",
      headers: sbHeaders("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify(rawRows),
    });
    if (!rawResp.ok) {
      const errText = await rawResp.text();
      return NextResponse.json({ error: `transactions_raw upsert failed: ${errText}` }, { status: 500 });
    }

    // 2. Update spa_ebitda_daily: add per-venue SGA delta for each affected date
    // The delta stored in sgaDelta is per_venue (already divided by 8).
    const ebitdaLog: string[] = [];
    for (const [date, perVenueDelta] of sgaDelta.entries()) {
      for (const v of VENUES) {
        const resp = await fetch(
          `${sbUrl("spa_ebitda_daily")}?date=eq.${date}&location_id=eq.${v.location_id}`,
          {
            method: "GET",
            headers: sbHeaders(),
          },
        );
        if (!resp.ok) { ebitdaLog.push(`WARN: GET ${date}/${v.slug} failed: ${await resp.text()}`); continue; }
        const rows = await resp.json() as Array<Record<string, unknown>>;
        if (!rows.length) { ebitdaLog.push(`SKIP: no spa_ebitda_daily row for ${date}/${v.slug}`); continue; }
        const currentSga = Number(rows[0].sga ?? 0);
        const newSga = +(currentSga + perVenueDelta).toFixed(2);
        const patchResp = await fetch(
          `${sbUrl("spa_ebitda_daily")}?date=eq.${date}&location_id=eq.${v.location_id}`,
          {
            method: "PATCH",
            headers: sbHeaders("return=minimal"),
            body: JSON.stringify({ sga: newSga }),
          },
        );
        if (!patchResp.ok) {
          ebitdaLog.push(`WARN: PATCH ${date}/${v.slug} failed: ${await patchResp.text()}`);
        } else {
          ebitdaLog.push(`OK: ${date}/${v.slug}: sga ${currentSga.toFixed(2)} → ${newSga.toFixed(2)}`);
        }
      }
    }

    return NextResponse.json({
      status: "ok",
      transactions_raw_rows_inserted: rawRows.length,
      spa_ebitda_daily_updates: ebitdaLog,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
