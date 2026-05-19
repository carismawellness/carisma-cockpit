import { NextRequest, NextResponse } from "next/server";
import { ZohoBooksClient } from "@/lib/etl/zoho-client";
import { fetchZohoSpaBreakdown, SLUG_DISPLAY, AccountRow, TagOption } from "@/lib/etl/zoho-spa-breakdown";
import { writeSheet } from "@/lib/integrations/google-sheets";

export const maxDuration = 60;

const EBITDA_SPREADSHEET_ID = "1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s";
const EBITDA_SHEET_NAME      = "EBITDA Zoho data";

const LINE_LABELS: Record<string, string> = {
  revenue:     "Revenue",
  cogs:        "COGS",
  wages:       "Wages & Salaries",
  advertising: "Advertising",
  rent:        "Rent",
  utilities:   "Utilities",
  sga:         "SG&A",
};

function buildSheetRows(
  tagOptions: TagOption[],
  accounts: AccountRow[],
  fromDate: string,
  toDate: string,
): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const venueHeaders = tagOptions.map(t => t.display_name);

  // Row 1: title
  rows.push([`Zoho SPA — Account Breakdown  |  ${fromDate} to ${toDate}`, ...Array(3 + venueHeaders.length).fill(null)]);

  // Row 2: column headers
  rows.push(["Account", "Code", "EBITDA Line", "Split Rule", ...venueHeaders, "Total (Zoho)"]);

  // Group accounts by EBITDA line
  const LINE_ORDER = ["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"];
  const grouped = new Map<string, AccountRow[]>();
  for (const acc of accounts) {
    if (!grouped.has(acc.ebitda_line)) grouped.set(acc.ebitda_line, []);
    grouped.get(acc.ebitda_line)!.push(acc);
  }

  for (const line of LINE_ORDER) {
    const lineAccounts = grouped.get(line);
    if (!lineAccounts) continue;

    // Section header
    const sectionTotal = lineAccounts.reduce((s, a) => s + a.total, 0);
    const sectionVenueTotals = tagOptions.map(t =>
      lineAccounts.reduce((s, a) => s + (a.venue_amounts[t.slug] ?? 0), 0)
    );
    rows.push([
      `— ${LINE_LABELS[line] ?? line} —`,
      null, null, null,
      ...sectionVenueTotals.map(v => Math.round(v * 100) / 100),
      Math.round(sectionTotal * 100) / 100,
    ]);

    // Account rows
    for (const acc of lineAccounts) {
      const venueAmts = tagOptions.map(t => {
        const v = acc.venue_amounts[t.slug] ?? 0;
        return v === 0 ? null : Math.round(v * 100) / 100;
      });
      const tagNote = acc.tagged_total > 0
        ? acc.untagged_amount > 0 ? "partial tag" : "tagged"
        : "split rule";
      rows.push([
        acc.name,
        acc.code || null,
        LINE_LABELS[acc.ebitda_line] ?? acc.ebitda_line,
        `${acc.split_rule} (${tagNote})`,
        ...venueAmts,
        Math.round(acc.total * 100) / 100,
      ]);
    }

    // Blank separator
    rows.push(Array(4 + venueHeaders.length + 1).fill(null));
  }

  return rows;
}

// GET — returns JSON breakdown (used by the Cockpit breakdown page)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  try {
    const client = new ZohoBooksClient("spa");
    const result = await fetchZohoSpaBreakdown(client, dateFrom, dateTo);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// POST — fetches from Zoho and writes directly to Google Sheets
export async function POST(req: NextRequest) {
  let dateFrom: string, dateTo: string;
  try {
    const body = await req.json();
    dateFrom = body.date_from;
    dateTo   = body.date_to;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  const log: string[] = [];

  try {
    log.push("Fetching Zoho SPA breakdown…");
    const client = new ZohoBooksClient("spa");
    const result = await fetchZohoSpaBreakdown(client, dateFrom, dateTo);
    log.push(...result.log);
    log.push(`Building sheet rows for ${result.accounts.length} accounts…`);

    const rows = buildSheetRows(result.tag_options, result.accounts, dateFrom, dateTo);
    log.push(`Writing ${rows.length} rows to "${EBITDA_SHEET_NAME}"…`);

    const { updatedRows } = await writeSheet(EBITDA_SPREADSHEET_ID, EBITDA_SHEET_NAME, rows);
    log.push(`Done — ${updatedRows} rows written to Google Sheets.`);

    return NextResponse.json({
      status:        "ok",
      accounts:      result.accounts.length,
      venues:        result.tag_options.length,
      rows_written:  updatedRows,
      period:        result.period,
      log:           log.join("\n"),
    });
  } catch (e) {
    const msg = String(e);
    log.push(`Error: ${msg}`);
    return NextResponse.json({ error: msg, log: log.join("\n") }, { status: 500 });
  }
}
