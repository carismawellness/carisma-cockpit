import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { loadHqCoaMap, runHqEbitdaMonth } from "@/lib/etl/hq-ebitda";
import { ETLLogger } from "@/lib/etl/etl-logger";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let dateFrom: string, dateTo: string, force = false;
  try {
    const body = await req.json();
    dateFrom = body.date_from;
    dateTo   = body.date_to;
    force    = body.force === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  const logger = new ETLLogger("zoho_hq_ebitda");
  await logger.start();
  const log: string[] = [];
  let totalRows = 0;

  try {
    // HQ transactions live in the Aesthetics Zoho org, filtered by HQ tag
    const client = new ZohoBooksClient("aesthetics");

    log.push("Loading HQ CoA mapping…");
    let coaMap: Record<string, [string, string]> = {};
    try {
      coaMap = await loadHqCoaMap();
      log.push(`Loaded ${Object.keys(coaMap).length} accounts from Supabase.`);
    } catch (e) {
      log.push(`Failed to load HQ CoA (${e}) — using name-based detection.`);
    }

    const fromD = new Date(dateFrom);
    const toD   = new Date(dateTo);
    let d = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    while (d <= toD) {
      const y = d.getFullYear(), m = d.getMonth() + 1;
      const isFirst = y === fromD.getFullYear() && m === fromD.getMonth() + 1;
      const isLast  = y === toD  .getFullYear() && m === toD  .getMonth() + 1;
      const result = await runHqEbitdaMonth(client, y, m, {
        force,
        coaMap,
        fromDateOverride: isFirst ? dateFrom : undefined,
        toDateOverride:   isLast  ? dateTo   : undefined,
      });
      totalRows += result.rowsUpserted;
      log.push(...result.log);
      d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    await logger.complete(totalRows);
    log.push(`Done — ${totalRows} rows upserted.`);
    return NextResponse.json({ status: "ok", rows_upserted: totalRows, log: log.join("\n") });
  } catch (e) {
    const msg = String(e);
    await logger.fail(msg);
    return NextResponse.json({ error: msg, log: log.join("\n") }, { status: 500 });
  }
}
