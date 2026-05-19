import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { fetchZohoTransactionsDaily, DailyResult } from "@/lib/etl/zoho-transactions-daily";
import { writeSheet } from "@/lib/integrations/google-sheets";

export const maxDuration = 300;

const EBITDA_SPREADSHEET_ID = "1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s";
const EBIDA_SHEET_NAME      = "EBIDA Layer";

function parseOrg(raw: string | null | undefined): "spa" | "aesthetics" {
  return raw === "aesthetics" ? "aesthetics" : "spa";
}

function buildSheetRows(result: DailyResult, org: "spa" | "aesthetics"): (string | number | null)[][] {
  const dates = result.dates;
  const headerWidth = 7 + dates.length;
  const rows: (string | number | null)[][] = [];

  const title = `Zoho Daily Transaction Layer  |  ${result.period.from_date} to ${result.period.to_date}  |  org=${org}`;
  rows.push([title, ...Array(headerWidth - 1).fill(null)]);

  rows.push([
    "Brand",
    "Venue",
    "Line Item",
    "Account Code",
    "EBITDA Category",
    "Split Rule",
    "Tag Source",
    ...dates,
  ]);

  for (const row of result.rows) {
    const dailyCells = dates.map(d => {
      const v = row.daily[d];
      return v == null || v === 0 ? null : v;
    });
    rows.push([
      row.brand,
      row.venue,
      row.account_name,
      row.account_code || null,
      row.ebitda_category,
      row.split_rule,
      row.tag_source,
      ...dailyCells,
    ]);
  }

  return rows;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");
  const org      = parseOrg(searchParams.get("org"));

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  try {
    const client = new ZohoBooksClient(org);
    const result = await fetchZohoTransactionsDaily(client, dateFrom, dateTo, org);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let dateFrom: string, dateTo: string, org: "spa" | "aesthetics";
  try {
    const body = await req.json();
    dateFrom = body.date_from;
    dateTo   = body.date_to;
    org      = parseOrg(body.org);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  const log: string[] = [];
  try {
    log.push(`Fetching Zoho daily transactions for org=${org}…`);
    const client = new ZohoBooksClient(org);
    const result = await fetchZohoTransactionsDaily(client, dateFrom, dateTo, org);
    log.push(...result.log);
    log.push(`Building sheet rows for ${result.rows.length} (account, venue) rows × ${result.dates.length} days…`);

    const sheetRows = buildSheetRows(result, org);
    log.push(`Writing ${sheetRows.length} rows to "${EBIDA_SHEET_NAME}"…`);

    const { updatedRows } = await writeSheet(EBITDA_SPREADSHEET_ID, EBIDA_SHEET_NAME, sheetRows);
    log.push(`Done — ${updatedRows} rows written to Google Sheets.`);

    return NextResponse.json({
      status:       "ok",
      rows:         result.rows.length,
      dates:        result.dates.length,
      rows_written: updatedRows,
      period:       result.period,
      log:          log.join("\n"),
    });
  } catch (e) {
    const msg = String(e);
    log.push(`Error: ${msg}`);
    return NextResponse.json({ error: msg, log: log.join("\n") }, { status: 500 });
  }
}
