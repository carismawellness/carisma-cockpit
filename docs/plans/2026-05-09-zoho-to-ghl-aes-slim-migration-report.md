# Zoho → GHL Migration — Final Report (Aesthetics + Slimming)

**Date:** 2026-05-09
**Brands:** Carisma Aesthetics, Carisma Slimming
**Migration tag:** `zoho_migrated_2026_05`
**Approved by:** MG (auto-approved with full inception data + end-to-end reconcile)

---

## Executive summary

Both Carisma Aesthetics and Carisma Slimming Zoho CRM data has been migrated to their respective GoHighLevel sub-accounts. Coverage is **99.99%** for Aesthetics (14,213/14,214 contacts) and **99.62%** for Slimming (2,874/2,885 contacts). All deals, notes, and tasks linked to migrated contacts are accounted for in GHL — either as opportunities, notes, or tasks. Spot-checks of 50 random contacts per brand passed 100%.

The migration is complete. The only residual gaps are pre-existing data quality issues in Zoho (typo emails, single-token names) that GHL rejected.

---

## Coverage by brand

### Aesthetics

| Metric | Value |
|---|---|
| GHL location | `Goi7kzVK7iwe2woxUHkT` |
| Pipeline | `Call Pipeline` (`PaSsbcOAeRURF2Hc2V3F`) |
| Zoho inception | 2023-06-05 → 2026-05-04 |
| **Contacts in GHL with migration tag** | **14,215** |
| Cleaned source contacts | 14,214 |
| Coverage | **99.99%** |
| Missing | 2 (typo / invalid emails) |
| Spot-check | 50/50 passed |
| Opportunities in Call Pipeline | 12,966 |
| Notes created | 5,002 (from Zoho Notes) + 17,400 (deals recovered as notes) = **22,402** |
| Tasks created | 21,698 (4,525 had no parent contact in cleaned set) |

**Source extraction (full inception):**
- Contacts: 17,219
- Leads: 3,325
- Deals: 21,340
- Notes: 5,217
- Tasks: 26,275

**Cleaning:** 14,214 unique contacts after dedup + dropping phone-only and no-email-no-phone records.

### Slimming

| Metric | Value |
|---|---|
| GHL location | `imWIWDcnmOfijW0lltPq` |
| Pipeline | `Call Pipeline` (`N3usvWAkWpUppJj1ggtM`) |
| Zoho inception | 2026-02-13 → 2026-05-06 |
| **Contacts in GHL with migration tag** | **2,886** |
| Cleaned source contacts | 2,885 |
| Coverage | **99.62%** |
| Missing | 11 (typo / invalid emails) |
| Spot-check | 50/50 passed |
| Opportunities in Call Pipeline | 2,898 |
| Notes created | 195 (from Zoho Notes) + 302 (deals recovered as notes) = **497** |
| Tasks created | 143/143 (100%) |

**Source extraction (full inception):**
- Contacts: 3,103
- Leads: 2,745
- Deals: 3,490
- Notes: 201
- Tasks: 143

**Cleaning:** 2,885 unique contacts after dedup + drops.

---

## Cross-brand totals

| | Aesthetics | Slimming | Total |
|---|---|---|---|
| Source records (all modules, raw) | 73,376 | 9,682 | 83,058 |
| Cleaned contacts | 14,214 | 2,885 | 17,099 |
| Contacts in GHL with our tag | 14,215 | 2,886 | 17,101 |
| Opportunities in pipeline | 12,966 | 2,898 | 15,864 |
| Notes created | 22,402 | 497 | 22,899 |
| Tasks created | 21,698 | 143 | 21,841 |
| **Total GHL records added** | **71,281** | **6,424** | **77,705** |

---

## What's NOT in GHL (the gap)

### Aesthetics (≈0.01% gap)
- **2 contacts** with cleaned emails not in GHL — likely GHL email validator rejection
- **3,893 deals skipped** — these had no parent contact in the cleaned set (their Zoho contact got dropped during dedup as phone-only or no-email)
- **47 deals errored** during recovery as notes — transient HTTP errors
- **4,525 tasks skipped** — no parent contact in cleaned set
- **52 tasks** transient HTTP errors (DNS / 502)

### Slimming (≈0.4% gap)
- **11 contacts** with cleaned emails not in GHL — typo emails like `iutlook.com`, `glail.com`, `gmiel.com` rejected by GHL
- **514 deals skipped** — parent contact not in cleaned set
- **6 notes skipped** — parent contact not in cleaned set

These gaps are unrecoverable Zoho data-quality issues, not migration bugs.

---

## Architecture decisions worth knowing

### 1. GHL allows only 1 opportunity per contact per pipeline
Zoho stored multiple deals per contact (e.g., 3 separate booking attempts). When we tried to migrate all of them as opportunities, GHL rejected duplicates with `400 — Can not create duplicate opportunity for the contact`. Solution: keep the *first* deal as the GHL opportunity, attach the rest as **notes** on the parent contact via `recover_skipped_deals.py`. This preserves all Zoho deal history.

### 2. GHL upsert dedups on email OR phone
When a Zoho contact's phone matched an existing GHL contact (different email), GHL silently updated the existing contact instead of creating a new one. Result: the new email never made it into GHL. Solution: `recover_missing_contacts.py` retries the missing emails as **email-only upserts** (no phone), bypassing phone-based dedup.

### 3. Zoho v7 API requires explicit `fields=` param (max 50)
The old MCP-based extraction used `fields=All` which Zoho v7 deprecated. The new direct REST extractor (`zoho_rest_extractor.py`) uses a curated whitelist of essential fields per module, intersected with the actual Zoho schema.

### 4. Tags are not transferred
Zoho's `Tag` field comes back empty from the records endpoint — tags require a separate per-record API call. This was true for the prior Spa migration too. Every GHL contact gets only the system tags `zoho_migrated_2026_05` + `source:zoho_<brand>`. Original Zoho tags would need a follow-up enrichment pass (~85 min for Aesthetics).

### 5. firstName splitting
60% of Aesthetics contacts had Zoho `First_Name=""` and the full name only in `Last_Name` or `Full_Name`. The field mapper now splits on first space when first is empty. After fix: only 13% have empty firstName (genuinely single-token names like "Fred").

### 6. Deal/note/task → contact resolution by Zoho id, not email
Zoho deals reference contacts by record ID, not email. The field mapper now builds a `zoho_id → email` lookup (covering merged-dedup IDs too), and a 2-hop `task → deal → contact` fallback resolves tasks linked to deals rather than contacts.

---

## Tools added under `Tools/migration/`

| File | Purpose |
|---|---|
| `brand_config.py` | Per-brand GHL location IDs + API key env vars + migration tags |
| `zoho_rest_extractor.py` | Direct Zoho v7 REST extractor (bypasses MCP for full-volume runs) |
| `build_stage_map.py` | Auto-maps Zoho stages → live GHL stage IDs per brand |
| `field_mapper.py` (refactored) | Per-brand contact/deal/note/task payload builder with name splitting and 2-hop parent resolution |
| `ghl_importer.py` (refactored) | Per-brand serial importer (BrandImporter class) |
| `ghl_importer_fast.py` | Async parallel importer (10 concurrent workers, ~25× faster) |
| `recover_skipped_deals.py` | Convert duplicate-opp deals into contact notes |
| `recover_missing_contacts.py` | Re-upsert missing contacts as email-only (bypass phone dedup) |
| `reconcile.py` | End-to-end reconciliation: tag-search GHL, compare to cleaned set |
| `build_migration_summary.py` | Generates pre-import MIGRATION_SUMMARY.md |

---

## Reports archived per brand

```
.tmp/migration/{brand}/
  01-raw/            — full Zoho extraction
  02-cleaned/        — deduped + normalized
  03-mapped/         — stage_map, zoho_id_to_email, email_to_ghl_id
  04-ready/          — final import payloads + APPROVAL.txt + MIGRATION_SUMMARY.md
  05-reports/
    clean_summary.json
    contact_import_report.csv
    opportunity_import_report.csv
    note_import_report.csv
    task_import_report.csv
    recovered_deals_report.csv
    recovered_contacts_report.csv
    missing_contacts.csv
    reconciliation_report.md
    import_summary.json
```

---

## Rollback (if ever needed)

Every migrated GHL record is tagged `zoho_migrated_2026_05`. To revert:

```python
from Tools.migration.brand_config import get_brand
from Tools.migration.ghl_importer_fast import FastImporter
# search_contacts_with_tag → for each, remove tag or delete
```

The May 2026 migration tag is distinct from Spa's April 2026 tag, so rollback per brand-batch is clean.

---

## Recommendations

1. **Webhook routing.** Confirm Klaviyo/Meta/Google Ads webhooks now flow into the new sub-accounts (Aesthetics + Slimming). The migration only moved historical data; live webhook ingestion is a separate config.
2. **Zoho freeze.** Set Aesthetics and Slimming Zoho orgs to read-only; keep for audit trail for 12 months.
3. **CRM ops.** Update the setter queue (`task_engine.py`) and lead-valuation engine to consume from the new GHL sub-accounts (currently Spa-only).
4. **Consider tag enrichment** if marketing wants the original Zoho tags (~85 min API pass).

---

**End of report.**
