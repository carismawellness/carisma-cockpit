import { ZohoBooksClient } from "./zoho-client";

// Pulls per-line transaction data from all relevant Zoho Books endpoints
// (invoices, bills, expenses, creditnotes, vendorcredits, journals) with their
// per-line reporting_tags. Used by the EBITDA ETLs to allocate amounts to
// venues/brands via line tag (primary) with split-rule fallback.

export type TxnSource =
  | "invoice"
  | "bill"
  | "expense"
  | "creditnote"
  | "vendorcredit"
  | "journal"
  | "customerpayment"
  | "vendorpayment"
  | "salesreturn"
  | "journal_report";   // auto-generated counterpart lines from reports/journal
                        // (e.g. invoice → COGS auto-postings) that don't appear
                        // in any entity endpoint's line_items array.

const BASE_CURRENCY = "EUR";

export type LineTag = { tag_option_id: string; tag_option_name: string };

export type TxnLine = {
  date:         string;          // YYYY-MM-DD (transaction date)
  source:       TxnSource;
  txn_id:       string;
  account_id:   string;
  account_code: string;          // resolved from chartofaccounts cache (may still be "")
  account_name: string;
  section:      "income" | "expense" | "other";
  amount:       number;          // signed; income contributes positive to revenue, expense contributes positive to cost. Credit notes / vendor credits flip sign.
  tags:         LineTag[];
  contact_name: string;          // Zoho vendor (for bills/expenses/vendorcredits) or customer (for invoices/creditnotes); "" for journals
};

export type AccountMeta = {
  code:    string;
  name:    string;
  type:    string;
  section: "income" | "expense" | "other";
};

const PAGE_THROTTLE_MS       = 1000;   // was 1500; dropped after broader OAuth scope unlocked all 6 endpoints
const RATE_LIMIT_BACKOFFS_MS = [15000, 30000, 60000];

async function callWithRetry<T>(fn: () => Promise<T>, label: string, log: string[]): Promise<T> {
  for (let attempt = 0; attempt <= RATE_LIMIT_BACKOFFS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e);
      const is429 = /\b429\b/.test(msg) || /code"?\s*:?\s*4[34]\b/.test(msg) || /maximum number of requests/i.test(msg);
      if (!is429 || attempt === RATE_LIMIT_BACKOFFS_MS.length) throw e;
      const wait = RATE_LIMIT_BACKOFFS_MS[attempt];
      log.push(`  rate-limited on ${label}, waiting ${wait / 1000}s before retry (attempt ${attempt + 1}/${RATE_LIMIT_BACKOFFS_MS.length})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error(`callWithRetry exhausted for ${label}`);
}

// ── Chart of accounts cache ──────────────────────────────────────────────────

export async function loadAccountMeta(client: ZohoBooksClient, log: string[]): Promise<Map<string, AccountMeta>> {
  const result = new Map<string, AccountMeta>();

  // Zoho's chartofaccounts list defaults to ACTIVE accounts only — inactive
  // accounts are silently dropped. Historical postings on accounts that have
  // since been deactivated (e.g. SPA 611142 "Motor Vehicles - Repairs &
  // Maintenance", marked inactive but with €408.53 of activity in Jan-Feb
  // 2025) would otherwise have no meta entry, causing every line on those
  // accounts to be dropped by the journal_report supplementary pass
  // (skippedNoMeta) and by every downstream consumer that keys off
  // account_code. To prevent that drift, we do TWO passes: the default
  // (active) list, then a second pass with filter_by=AccountType.Inactive
  // to merge in deactivated accounts. We can't use filter_by=AccountType.All
  // — that endpoint omits 80+ active expense/COGS accounts that the default
  // view exposes (verified on SPA 2026-05-21: default=412, All=360, with
  // Rent/Wages/Salary accounts missing).
  async function loadPass(extra: Record<string, string>, label: string) {
    let page = 1;
    while (true) {
      const data = await callWithRetry(
        () => client.get("chartofaccounts", { page: String(page), per_page: "200", ...extra }) as Promise<Record<string, unknown>>,
        `chartofaccounts ${label} page ${page}`,
        log,
      );
      const accounts = (data.chartofaccounts ?? []) as Array<Record<string, unknown>>;
      for (const a of accounts) {
        const id = String(a.account_id ?? "");
        if (!id) continue;
        // Active pass wins ties — skip if we already saw this id (only
        // matters when the same account appears in both passes, which it
        // shouldn't, but be defensive).
        if (result.has(id)) continue;
        const type = String(a.account_type ?? "").toLowerCase();
        let section: AccountMeta["section"] = "other";
        if (type.includes("income") || type.includes("revenue")) section = "income";
        else if (type.includes("expense") || type.includes("cost_of_goods") || type.includes("cogs")) section = "expense";
        result.set(id, {
          code:    String(a.account_code ?? "").trim(),
          name:    String(a.account_name ?? "").trim(),
          type,
          section,
        });
      }
      const ctx = data.page_context as Record<string, unknown> | undefined;
      if (!ctx?.has_more_page) break;
      page++;
    }
  }

  await loadPass({}, "active");
  const afterActive = result.size;
  try {
    await loadPass({ filter_by: "AccountType.Inactive" }, "inactive");
    log.push(`loadAccountMeta: active=${afterActive} +inactive=${result.size - afterActive} total=${result.size}`);
  } catch (e) {
    // Don't fail the whole pull if the inactive-filter endpoint changes —
    // we still have all active accounts.
    log.push(`  WARN inactive-account pass failed: ${e}; continuing with ${afterActive} active accounts`);
  }
  return result;
}

// ── Per-endpoint config ──────────────────────────────────────────────────────

type EndpointConfig = {
  source:        TxnSource;
  listKey:       string;          // response[listKey] is the array of summary objects
  detailKey:     string;           // response[detailKey] inside the detail call
  idField:       string;           // field name on summary item that holds the id
  dateField:     string;           // field on summary that has the transaction date (YYYY-MM-DD)
  lineKey:       string;           // field on detail entity holding line array
  contactField:  string[];        // field(s) on detail entity holding contact name; tried in order
  signMultiplier: 1 | -1;          // -1 for creditnotes (negate revenue) and vendorcredits (negate expense)
  dateStartParam: string;          // list filter param for inclusive start date
  dateEndParam:   string;          // list filter param for inclusive end date
};

const ENDPOINTS: EndpointConfig[] = [
  { source: "invoice",         listKey: "invoices",         detailKey: "invoice",         idField: "invoice_id",       dateField: "date",         lineKey: "line_items",   contactField: ["customer_name"],                        signMultiplier:  1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
  { source: "bill",            listKey: "bills",            detailKey: "bill",            idField: "bill_id",          dateField: "date",         lineKey: "line_items",   contactField: ["vendor_name"],                          signMultiplier:  1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
  { source: "expense",         listKey: "expenses",         detailKey: "expense",         idField: "expense_id",       dateField: "date",         lineKey: "line_items",   contactField: ["vendor_name", "paid_through_account_name", "customer_name"], signMultiplier:  1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
  { source: "creditnote",      listKey: "creditnotes",      detailKey: "creditnote",      idField: "creditnote_id",    dateField: "date",         lineKey: "line_items",   contactField: ["customer_name"],                        signMultiplier: -1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
  { source: "vendorcredit",    listKey: "vendor_credits",   detailKey: "vendor_credit",   idField: "vendor_credit_id", dateField: "date",         lineKey: "line_items",   contactField: ["vendor_name"],                          signMultiplier: -1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
  { source: "journal",         listKey: "journals",         detailKey: "journal",         idField: "journal_id",       dateField: "journal_date", lineKey: "line_items",   contactField: ["contact_name", "customer_name"],        signMultiplier:  1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
  { source: "customerpayment", listKey: "customerpayments", detailKey: "payment",         idField: "payment_id",       dateField: "date",         lineKey: "bank_charges", contactField: ["customer_name"],                        signMultiplier:  1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
  { source: "vendorpayment",   listKey: "vendorpayments",   detailKey: "vendorpayment",   idField: "payment_id",       dateField: "date",         lineKey: "bank_charges", contactField: ["vendor_name"],                          signMultiplier:  1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
  { source: "salesreturn",     listKey: "salesreturns",     detailKey: "salesreturn",     idField: "salesreturn_id",   dateField: "date",         lineKey: "line_items",   contactField: ["customer_name"],                        signMultiplier: -1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
];

const ENDPOINT_PATH: Record<TxnSource, string> = {
  invoice:         "invoices",
  bill:            "bills",
  expense:         "expenses",
  creditnote:      "creditnotes",
  vendorcredit:    "vendorcredits",
  journal:         "journals",
  customerpayment: "customerpayments",
  vendorpayment:   "vendorpayments",
  salesreturn:     "salesreturns",
  // Pseudo-source — these lines come from reports/journal, not a list+detail
  // entity endpoint. The path is unused but the key must exist to satisfy the
  // Record<TxnSource, string> type.
  journal_report:  "reports/journal",
};

// ── List + detail pagination per endpoint ────────────────────────────────────

async function listAllPages(
  client: ZohoBooksClient,
  cfg: EndpointConfig,
  fromDate: string,
  toDate: string,
  log: string[],
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let page = 1;
  let pageCount = 0;
  const path = ENDPOINT_PATH[cfg.source];
  while (true) {
    if (pageCount > 0) await new Promise(r => setTimeout(r, PAGE_THROTTLE_MS));
    const params: Record<string, string> = {
      page:     String(page),
      per_page: "200",
      [cfg.dateStartParam]: fromDate,
      [cfg.dateEndParam]:   toDate,
    };
    const data = await callWithRetry(
      () => client.get(path, params) as Promise<Record<string, unknown>>,
      `${path} list page ${page}`,
      log,
    );
    pageCount++;
    const items = (data[cfg.listKey] as Array<Record<string, unknown>>) ?? [];
    out.push(...items);
    const ctx = data.page_context as Record<string, unknown> | undefined;
    if (!ctx?.has_more_page) break;
    page++;
  }
  return out;
}

function pickAmount(line: Record<string, unknown>, isInclusiveTax: boolean): number {
  // Order matches Zoho's per-line field availability across endpoint types.
  // bcy_* (base-currency) variants are PREFERRED over plain amount/item_total
  // because Zoho gives the latter in the transaction's source currency.
  let amt = 0;
  for (const field of ["bcy_amount", "bcy_total", "amount", "item_total", "total"]) {
    const v = line[field];
    if (v != null) {
      const n = Number(v);
      if (!isNaN(n)) { amt = n; break; }
    }
  }
  // When the entity is recorded tax-inclusive, line.amount / item_total are
  // GROSS (incl VAT) but Zoho posts only the NET to the income/expense
  // account — VAT goes to a balance-sheet input/output VAT account. The
  // gross-tax-inclusive expense booked €804.24 on a Computers & Electronics
  // line carrying €122.68 of 18% VAT lands as €681.56 in the P&L, so
  // returning the picked gross would over-state that account by 18%. Detect
  // the line-level override first (Zoho allows per-line overrides via
  // `tax_treatment_code` / `is_inclusive_tax`), fall back to the entity flag.
  // Verified 2026-05-27 on SPA expenses 128265000029132178 + …92 (Apr 2026
  // 616730 Computers & Electronics, €1,262.74 gross vs €1,070.12 net).
  if (amt) {
    const lineInclusive = line.is_inclusive_tax;
    const inclusive = typeof lineInclusive === "boolean" ? lineInclusive : isInclusiveTax;
    if (inclusive) {
      const tax = Number(line.tax_amount ?? 0);
      if (tax) amt -= tax;
    }
  }
  return amt;
}

/**
 * Returns true if the line already carries a base-currency (bcy_*) field
 * with a finite numeric value. When true, FX conversion is a no-op because
 * pickAmount/pickJournalAmount already returned the pre-converted figure.
 */
function lineHasBcyAmount(line: Record<string, unknown>): boolean {
  for (const field of ["bcy_amount", "bcy_total"]) {
    const v = line[field];
    if (v != null) {
      const n = Number(v);
      if (!isNaN(n)) return true;
    }
  }
  return false;
}

/**
 * Convert a raw line amount (already in transaction currency) to base
 * currency (EUR) using the parent entity's exchange_rate when needed.
 * Returns null if conversion is impossible (missing/zero rate) so the
 * caller can skip the line with a warning instead of producing bad data.
 */
function convertToBaseCurrency(
  rawAmount:         number,
  lineAlreadyInBcy:  boolean,
  entityCurrency:    string,
  entityExchangeRate: number,
  txnSource:         TxnSource,
  txnId:             string,
  log:               string[],
): number | null {
  const ccy = entityCurrency.trim().toUpperCase();
  if (!ccy || ccy === BASE_CURRENCY) return rawAmount;
  // Foreign currency. If Zoho already gave us a bcy_* field on the line,
  // it's already in EUR — return as-is.
  if (lineAlreadyInBcy) return rawAmount;
  if (!entityExchangeRate || !isFinite(entityExchangeRate) || entityExchangeRate <= 0) {
    log.push(`  WARN skip ${txnSource}/${txnId}: ${ccy} line with missing/zero exchange_rate`);
    return null;
  }
  const converted = rawAmount * entityExchangeRate;
  // Round to 2 dp so downstream daily sums don't carry FX float noise.
  return Math.round(converted * 100) / 100;
}

function pickJournalAmount(line: Record<string, unknown>, section: "income" | "expense" | "other"): number {
  // Journal lines have debit_or_credit + amount. Income accounts: credit > debit is positive revenue. Expense accounts: debit > credit is positive expense.
  const direction = String(line.debit_or_credit ?? "").toLowerCase();
  const amt = Number(line.bcy_amount ?? line.amount ?? 0);
  if (!amt) return 0;
  const signedDebit = direction === "debit" ? amt : -amt;
  if (section === "income")  return -signedDebit; // credit positive
  if (section === "expense") return  signedDebit; // debit positive
  return signedDebit;
}

function extractTags(line: Record<string, unknown>): LineTag[] {
  const raw = (line.tags ?? line.reporting_tags) as Array<Record<string, unknown>> | undefined;
  if (!raw || !Array.isArray(raw)) return [];
  const out: LineTag[] = [];
  for (const t of raw) {
    const id   = String(t.tag_option_id   ?? "");
    const name = String(t.tag_option_name ?? "");
    if (id && name) out.push({ tag_option_id: id, tag_option_name: name });
  }
  return out;
}

async function fetchDetails(
  client: ZohoBooksClient,
  cfg: EndpointConfig,
  summaries: Array<Record<string, unknown>>,
  accountMeta: Map<string, AccountMeta>,
  log: string[],
): Promise<TxnLine[]> {
  const lines: TxnLine[] = [];
  const path = ENDPOINT_PATH[cfg.source];
  for (let i = 0; i < summaries.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, PAGE_THROTTLE_MS));
    const s = summaries[i];
    const id = String(s[cfg.idField] ?? "");
    if (!id) continue;

    const detail = await callWithRetry(
      () => client.get(`${path}/${id}`) as Promise<Record<string, unknown>>,
      `${path}/${id}`,
      log,
    );
    // Some endpoints return a different detail wrapper key than expected
    // (e.g. customer-payments has historically used "payment" or
    // "customerpayment"). Fall back through a small candidate list before
    // giving up so a single key change in the Zoho API doesn't break us.
    const detailKeyCandidates =
      cfg.source === "customerpayment" ? [cfg.detailKey, "payment", "customerpayment"]
      : cfg.source === "vendorpayment"  ? [cfg.detailKey, "vendorpayment", "vendor_payment", "payment"]
      : [cfg.detailKey];
    let entity: Record<string, unknown> = {};
    for (const k of detailKeyCandidates) {
      const candidate = detail[k];
      if (candidate && typeof candidate === "object") {
        entity = candidate as Record<string, unknown>;
        break;
      }
    }

    // Transaction date: prefer header field, fall back to summary
    const txnDate = String(entity[cfg.dateField] ?? s[cfg.dateField] ?? "").slice(0, 10);
    if (!txnDate) continue;

    // Skip unposted transactions. Zoho's P&L excludes BOTH draft and void
    // transactions of every type; emitting them here over-counts vs the P&L.
    // Entity LIST endpoints return drafts/voids alongside posted entries.
    // Filter at the detail stage where `status` is reliable. This also keeps
    // the journal-report supplementary pass safe — the `covered`
    // (entity_id, account_id) Set would otherwise mask the corresponding
    // report row even though Zoho never posted it.
    //  - journals: only "published" counts (draft journals verified on SPA
    //    Jan-Feb 2025 — 2 of 148 were draft).
    //  - all other entity types: drop "draft" and "void" (verified 2026-05-22
    //    — void bill INV-2025-001 €4,354.20 inc-VAT leaked €3,690 ex-VAT into
    //    SPA account 611193 for Mar 2025).
    const entityStatus = String(entity.status ?? s.status ?? "").toLowerCase();
    if (cfg.source === "journal") {
      if (entityStatus && entityStatus !== "published") {
        log.push(`  skip journal/${id}: status="${entityStatus}" (not published)`);
        continue;
      }
    } else if (entityStatus === "draft" || entityStatus === "void") {
      log.push(`  skip ${cfg.source}/${id}: status="${entityStatus}"`);
      continue;
    }

    // FX context: every transaction header carries currency_code +
    // exchange_rate (rate is base-per-foreign, e.g. 0.0274 EUR per TRY).
    // When currency is non-EUR we must scale plain `amount` fields up by
    // the rate, unless the line already exposes a bcy_* (base currency) value.
    const entityCurrency      = String(entity.currency_code ?? s.currency_code ?? "EUR");
    const entityExchangeRate  = Number(entity.exchange_rate ?? s.exchange_rate ?? 1);

    // Transaction-header tags act as a fallback when no line tag is present
    const headerTags = extractTags(entity);

    // Contact name (vendor / customer) — used downstream for the advertising
    // sub-bucket. Try fields in priority order; fall back to summary then "".
    let contactName = "";
    for (const f of cfg.contactField) {
      const v = entity[f] ?? s[f];
      if (v && String(v).trim()) { contactName = String(v).trim(); break; }
    }

    // ── Special branch: customer/vendor payments ──
    // Payments don't carry line_items. They expose a single header-level
    // `bank_charges` number that books to a configured bank-fees expense
    // account (e.g. SPA org account 616780). We synthesise ONE TxnLine per
    // payment when bank_charges > 0.
    if (cfg.source === "customerpayment" || cfg.source === "vendorpayment") {
      const bankCharges = Number(entity.bank_charges ?? 0);
      if (!bankCharges || bankCharges <= 0) continue;
      const accountId = String(
        entity.bank_charges_account_id ??
        entity.account_id ??
        "",
      );
      if (!accountId) {
        log.push(`  WARN ${cfg.source}/${id}: bank_charges=${bankCharges} but no bank_charges_account_id; skipping`);
        continue;
      }
      const meta = accountMeta.get(accountId);
      const section = meta?.section ?? "other";
      if (section !== "expense") continue;  // sanity: bank fees must hit an expense account

      // Convert bank_charges to base currency. Payment headers expose the
      // amount in transaction currency; there is no bcy_* equivalent on the
      // header, so we always apply the exchange rate when ccy ≠ EUR.
      const converted = convertToBaseCurrency(
        bankCharges,
        /* lineAlreadyInBcy */ false,
        entityCurrency,
        entityExchangeRate,
        cfg.source,
        id,
        log,
      );
      if (converted == null || converted === 0) continue;

      lines.push({
        date:         txnDate,
        source:       cfg.source,
        txn_id:       id,
        account_id:   accountId,
        account_code: meta?.code ?? "",
        account_name: meta?.name ?? "Bank Charges",
        section,
        amount:       converted * cfg.signMultiplier,
        tags:         headerTags,
        contact_name: contactName,
      });
      continue;
    }

    const lineArr  = (entity[cfg.lineKey] as Array<Record<string, unknown>>) ?? [];
    // Entity-level tax-inclusivity flag — fed into pickAmount so gross-incl-tax
    // line amounts can be reduced to the net actually posted to the GL.
    const entityInclusiveTax = entity.is_inclusive_tax === true;

    for (const ln of lineArr) {
      const accountId = String(ln.account_id ?? "");
      if (!accountId) continue;
      const meta = accountMeta.get(accountId);
      const section = meta?.section ?? "other";
      if (section === "other") continue;  // skip balance-sheet movements

      let rawAmount: number;
      if (cfg.source === "journal") {
        rawAmount = pickJournalAmount(ln, section);
      } else {
        rawAmount = pickAmount(ln, entityInclusiveTax) * cfg.signMultiplier;
      }
      if (rawAmount === 0) continue;

      const converted = convertToBaseCurrency(
        rawAmount,
        lineHasBcyAmount(ln),
        entityCurrency,
        entityExchangeRate,
        cfg.source,
        id,
        log,
      );
      if (converted == null || converted === 0) continue;

      const tags = extractTags(ln);
      const effectiveTags = tags.length ? tags : headerTags;

      // Journal entries store the employee/contact at the LINE level as `customer_name`
      // (not on the journal header). E.g. payroll journals have the employee name on
      // each debit line. Use the line-level contact when present; fall back to the
      // journal header contact, then "".
      const lineContact = cfg.source === "journal"
        ? (String(ln.customer_name ?? ln.contact_name ?? "").trim() || contactName)
        : contactName;

      lines.push({
        date:         txnDate,
        source:       cfg.source,
        txn_id:       id,
        account_id:   accountId,
        account_code: meta?.code ?? String(ln.account_code ?? "").trim(),
        account_name: meta?.name ?? String(ln.account_name ?? "").trim(),
        section,
        amount:       converted,
        tags:         effectiveTags,
        contact_name: lineContact,
      });
    }
  }
  return lines;
}

// ── reports/journal (supplementary auto-posting capture) ─────────────────────
//
// The 9 entity endpoints above only expose user-entered line_items. When Zoho
// posts an invoice with a tracked inventory item, it auto-generates COGS and
// inventory-credit JOURNAL counterparts on the back end — these never appear
// on the invoice's line_items array, but they DO appear in the journal report.
//
// Strategy: pull reports/journal for the same window, then drop any
// (transaction_id, account_id) pair already covered by an entity endpoint
// (the entity version wins because it carries reporting_tags). Only gaps are
// added with source="journal_report".

// Zoho returns dates in "DD Mon YYYY" form on the journal report — parse to YYYY-MM-DD.
const MONTH_ABBREV: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function parseJournalReportDate(s: string): string | null {
  if (!s) return null;
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mon = MONTH_ABBREV[m[2].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${day}`;
}

/**
 * Compute the signed amount for one account_transactions row on the journal
 * report. Income: credit positive (credit - debit). Expense: debit positive
 * (debit - credit). The plain `debit_amount` / `credit_amount` are ALREADY in
 * base currency (EUR) per the Zoho schema; `*_fcy_amount` is the foreign
 * value. We deliberately use the base-currency fields so no FX conversion is
 * needed.
 */
function pickJournalReportAmount(
  at: Record<string, unknown>,
  section: "income" | "expense" | "other",
): number {
  const debit  = Number(at.debit_amount  ?? 0);
  const credit = Number(at.credit_amount ?? 0);
  if (!debit && !credit) return 0;
  if (section === "income")  return credit - debit;
  if (section === "expense") return debit - credit;
  return debit - credit;
}

async function fetchJournalReportLines(
  client:      ZohoBooksClient,
  fromDate:    string,
  toDate:      string,
  accountMeta: Map<string, AccountMeta>,
  covered:     Set<string>,
  log:         string[],
): Promise<{ lines: TxnLine[]; rawCount: number; addedCount: number; skippedCovered: number; skippedSection: number; skippedZero: number; skippedNoMeta: number; skippedDupe: number }> {
  const lines: TxnLine[] = [];
  let rawCount = 0, addedCount = 0, skippedCovered = 0, skippedSection = 0, skippedZero = 0, skippedNoMeta = 0, skippedDupe = 0;
  // Defensive within-pull dedupe set keyed by (transaction_id, account_id).
  // The prior `covered` Set only contains keys from the 9 entity-endpoint
  // passes, so it CANNOT mask non-entity report sources like
  // `sales_without_invoices` and `deposit` (verified 2026-05-21 on SPA
  // Jan-Feb 2025: 000003 + 000004 are `deposit`-type, only surfaced via
  // reports/journal). If a future page-context bug causes Zoho to return
  // the same account_transactions row on two adjacent pages, this Set
  // prevents double-counting. Keyed by transaction_id (the per-line PK in
  // the journal report) — entity_id can legitimately repeat across rows.
  const emitted = new Set<string>();
  let page = 1;
  let pageCount = 0;
  while (true) {
    if (pageCount > 0) await new Promise(r => setTimeout(r, PAGE_THROTTLE_MS));
    const params: Record<string, string> = {
      filter_by: "TransactionDate.CustomDate",
      from_date: fromDate,
      to_date:   toDate,
      per_page:  "200",
      page:      String(page),
    };
    let data: Record<string, unknown>;
    try {
      data = await callWithRetry(
        () => client.get("reports/journal", params) as Promise<Record<string, unknown>>,
        `reports/journal page ${page}`,
        log,
      );
    } catch (e) {
      log.push(`  WARN reports/journal page ${page} failed: ${e}; aborting journal-report pull`);
      break;
    }
    pageCount++;
    const entries = (data.journal as Array<Record<string, unknown>>) ?? [];
    for (const j of entries) {
      // IMPORTANT: the journal report has TWO ids per entry:
      //   - transaction_id: an internal id specific to the journal report
      //     (does NOT equal the entity's own id — e.g. for a bill it differs
      //      from bill_id)
      //   - entity_id: the entity's own id (= bill_id / invoice_id / etc.)
      // We use entity_id as the txn_id so the (txn_id, account_id) covered
      // Set actually matches the entity-endpoint lines.
      const entityId = String(j.entity_id ?? "");
      const txnId    = entityId || String(j.transaction_id ?? "");
      if (!txnId) continue;
      const rawDate = String(j.date ?? "");
      const isoDate = parseJournalReportDate(rawDate);
      if (!isoDate) {
        log.push(`  WARN reports/journal: unparseable date "${rawDate}" on txn ${txnId}; skipping`);
        continue;
      }
      const contactName = String(j.contact_name ?? "").trim();
      const atRows      = (j.account_transactions as Array<Record<string, unknown>>) ?? [];
      for (const at of atRows) {
        rawCount++;
        const accountId = String(at.account_id ?? "");
        if (!accountId) continue;

        const key = `${txnId}::${accountId}`;
        if (covered.has(key)) { skippedCovered++; continue; }

        const meta = accountMeta.get(accountId);
        if (!meta) { skippedNoMeta++; continue; }
        if (meta.section === "other") { skippedSection++; continue; }

        const amount = pickJournalReportAmount(at, meta.section);
        if (!amount) { skippedZero++; continue; }

        // Pagination dedupe — see `emitted` declaration above. Keyed by
        // transaction_id (not entity_id) because Zoho's report uses
        // transaction_id as the per-line PK within the report; the same
        // entity_id can legitimately appear under multiple transaction_ids
        // (e.g. a bill and its auto-posted COGS counterpart).
        const dedupeKey = `${String(j.transaction_id ?? txnId)}::${accountId}`;
        if (emitted.has(dedupeKey)) { skippedDupe++; continue; }
        emitted.add(dedupeKey);

        lines.push({
          date:         isoDate,
          source:       "journal_report",
          txn_id:       txnId,
          account_id:   accountId,
          account_code: meta.code || String(at.account_code ?? "").trim(),
          account_name: meta.name || String(at.name ?? at.account_name ?? "").trim(),
          section:      meta.section,
          amount,
          tags:         [],                // auto-postings carry no reporting_tags
          contact_name: contactName,
        });
        addedCount++;
      }
    }
    const ctx = data.page_context as Record<string, unknown> | undefined;
    if (!ctx?.has_more_page) break;
    page++;
  }
  return { lines, rawCount, addedCount, skippedCovered, skippedSection, skippedZero, skippedNoMeta, skippedDupe };
}

// ── Public entry point ───────────────────────────────────────────────────────

export type LinePullResult = {
  lines:        TxnLine[];
  accountMeta:  Map<string, AccountMeta>;
  log:          string[];
  perSourceCount: Record<TxnSource, number>;
};

export async function fetchTransactionLines(
  client: ZohoBooksClient,
  fromDate: string,
  toDate: string,
): Promise<LinePullResult> {
  const log: string[] = [];

  log.push("Loading chart of accounts…");
  const accountMeta = await loadAccountMeta(client, log);
  log.push(`Loaded ${accountMeta.size} accounts`);

  const allLines: TxnLine[] = [];
  const perSourceCount: Record<TxnSource, number> = {
    invoice: 0, bill: 0, expense: 0, creditnote: 0, vendorcredit: 0, journal: 0,
    customerpayment: 0, vendorpayment: 0, salesreturn: 0, journal_report: 0,
  };

  for (const cfg of ENDPOINTS) {
    log.push(`\n[${cfg.source}] listing ${fromDate} … ${toDate}`);
    let summaries: Array<Record<string, unknown>>;
    try {
      summaries = await listAllPages(client, cfg, fromDate, toDate, log);
    } catch (e) {
      log.push(`  list failed: ${e}`);
      continue;
    }
    log.push(`[${cfg.source}] ${summaries.length} txn(s); fetching details…`);
    let lines: TxnLine[];
    try {
      lines = await fetchDetails(client, cfg, summaries, accountMeta, log);
    } catch (e) {
      log.push(`  detail fetch failed: ${e}`);
      continue;
    }
    perSourceCount[cfg.source] = lines.length;
    allLines.push(...lines);
    log.push(`[${cfg.source}] extracted ${lines.length} line(s)`);
  }

  // Supplementary pass: reports/journal captures auto-generated counterpart
  // lines (e.g. invoice → COGS / inventory) that none of the entity endpoints
  // expose. We only add lines whose (txn_id, account_id) isn't already covered.
  log.push(`\n[journal_report] supplementary pull ${fromDate} … ${toDate}`);
  const covered = new Set<string>();
  for (const l of allLines) {
    if (!l.txn_id || !l.account_id) continue;
    covered.add(`${l.txn_id}::${l.account_id}`);
  }
  try {
    const jr = await fetchJournalReportLines(client, fromDate, toDate, accountMeta, covered, log);
    perSourceCount.journal_report = jr.lines.length;
    allLines.push(...jr.lines);
    log.push(
      `[journal_report] raw=${jr.rawCount} added=${jr.addedCount} ` +
      `skipped_covered=${jr.skippedCovered} skipped_section=${jr.skippedSection} ` +
      `skipped_zero=${jr.skippedZero} skipped_no_meta=${jr.skippedNoMeta} ` +
      `skipped_dupe=${jr.skippedDupe}`,
    );
  } catch (e) {
    log.push(`  WARN journal_report pull failed: ${e}; continuing without supplementary lines`);
  }

  log.push(`\nTotal lines across endpoints: ${allLines.length}`);
  return { lines: allLines, accountMeta, log, perSourceCount };
}
