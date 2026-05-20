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
  | "salesreturn";

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
  let page = 1;
  while (true) {
    const data = await callWithRetry(
      () => client.get("chartofaccounts", { page: String(page), per_page: "200" }) as Promise<Record<string, unknown>>,
      `chartofaccounts page ${page}`,
      log,
    );
    const accounts = (data.chartofaccounts ?? []) as Array<Record<string, unknown>>;
    for (const a of accounts) {
      const id = String(a.account_id ?? "");
      if (!id) continue;
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
  { source: "journal",         listKey: "journals",         detailKey: "journal",         idField: "journal_id",       dateField: "journal_date", lineKey: "line_items",   contactField: [],                                       signMultiplier:  1, dateStartParam: "date_start",         dateEndParam: "date_end"         },
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

function pickAmount(line: Record<string, unknown>): number {
  // Order matches Zoho's per-line field availability across endpoint types.
  // bcy_* (base-currency) variants are PREFERRED over plain amount/item_total
  // because Zoho gives the latter in the transaction's source currency.
  for (const field of ["bcy_amount", "bcy_total", "amount", "item_total", "total"]) {
    const v = line[field];
    if (v != null) {
      const n = Number(v);
      if (!isNaN(n)) return n;
    }
  }
  return 0;
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
        rawAmount = pickAmount(ln) * cfg.signMultiplier;
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
        contact_name: contactName,
      });
    }
  }
  return lines;
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
    customerpayment: 0, vendorpayment: 0, salesreturn: 0,
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

  log.push(`\nTotal lines across endpoints: ${allLines.length}`);
  return { lines: allLines, accountMeta, log, perSourceCount };
}
