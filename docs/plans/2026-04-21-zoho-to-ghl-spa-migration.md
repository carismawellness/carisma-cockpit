# Zoho CRM → GoHighLevel Migration Plan (All 3 Brands)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Date:** 2026-04-21
**Owner:** CRM Architecture (Mert)
**Brands in scope:** Carisma Spa & Wellness · Carisma Aesthetics · Carisma Slimming
**Working directory:** `/Users/mertgulen/Library/CloudStorage/GoogleDrive-mertgulen98@gmail.com/My Drive/Carisma Wellness Group/Carisma AI /Carisma AI`

| Brand | Zoho CRM MCP | GHL Account | Action |
|---|---|---|---|
| **Spa** | `mcp__zoho-crm-spa__*` | Active sub-account | Extract → Clean → **Import now** |
| **Aesthetics** | `mcp__zoho-crm-aesthetics__*` | Not yet set up | Extract → Clean → **Save only** |
| **Slimming** | `mcp__zoho-crm-slimming__*` | Not yet set up | Extract → Clean → **Save only** |

**Phase 1 (3 parallel agents) extracts all brands simultaneously.**
**Only Spa proceeds to GHL import. Aes + Slimming sit in `.tmp/` ready to import once GHL sub-accounts are live.**

---

## 1. Executive Summary

We are consolidating all three Carisma brands' historical CRM data from Zoho CRM into GoHighLevel. Spa is imported immediately (GHL sub-account is live). Aesthetics and Slimming are extracted and cleaned now so they are import-ready the moment those GHL accounts are created — no re-extraction needed.

### What this migration does
1. **Parallel extraction** of all 3 brands from Zoho CRM simultaneously (3 subagents, one per brand).
2. **Deterministic cleaning** per brand: dedup by email → phone, E.164 normalization, drop phone-only contacts, drop invalid emails.
3. **Best-fit pipeline stage mapping** — Zoho stage names are mapped to the closest GHL stage by name similarity + stage position. Human signs off the map before import.
4. **Field mapping** from Zoho schema → GHL schema (including pipeline stage translation and custom field creation).
5. **Human-gated approval** before any write to GHL.
6. **Batched import to GHL Spa only** with rate limiting + post-import integrity verification.
7. **Aesthetics + Slimming** cleaned payloads saved to `.tmp/migration/aesthetics/04-ready/` and `.tmp/migration/slimming/04-ready/` — ready to import on demand.

### Why now
- Meta/Klaviyo/Google Ads webhooks already flow into GHL; historical Zoho data is stranded.
- Setter queue (`task_engine.py`) can only act on GHL contacts — dormant Zoho leads are invisible.
- Lead valuation engine (`config.py::resolve_lead_value`) needs the full historical book to attribute LTV.

### Key risks (and mitigations)
| Risk | Mitigation |
|---|---|
| Overwriting live GHL contacts with stale Zoho data | Upsert by email with `mergeStrategy=preserve_recent_updates`; dry-run first |
| Phone collisions creating duplicate GHL records | Dedup pass before import; `get_duplicate_contact` pre-check per record |
| Pipeline stage drift (Zoho stages ≠ GHL stages) | Explicit mapping table signed off by Sales (see §Mapping) |
| Rate limiting (GHL 100 req/10s, Zoho 200 req/min) | Token bucket in `ghl_importer.py`; batched 100-record pages for Zoho bulk read |
| PII leak through `.tmp/` | `.tmp/` is gitignored; migration artifacts purged after go-live |
| Irreversible imports | Every imported record tagged `zoho_migrated_2026_04` for mass-rollback query |

### Rollback one-liner
Every imported contact gets tag `zoho_migrated_2026_04`. Rollback = `bulk_update_contact_tags` remove + soft-delete any contacts created only by this migration (see §8).

---

## 2. Pre-flight Checklist

Before running `Tools/migration/run_migration.py`, confirm every line:

### Credentials & access
- [ ] `.env` contains `GHL_API_KEY` (private integration key, scopes: contacts.write, opportunities.write, tags.write, notes.write, tasks.write, customFields.write)
- [ ] `.env` contains `GHL_LOCATION_ID` = Spa sub-account ID
- [ ] `.env` contains `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` (or MCP `zoho-crm-spa` is authenticated)
- [ ] Run `python -c "from CRM.ghl.client import GHLClient; print(GHLClient().get_pipelines())"` and confirm Spa pipeline is listed
- [ ] Run `mcp__zoho-crm-spa__zoho_get_org` and confirm org is Carisma Spa (Malta)

### GHL target setup
- [ ] Spa pipeline exists in GHL with stages matching `CRM/ghl/config.py::ACTIVE_STAGES + TERMINAL_STAGES`
- [ ] Stage IDs in `CRM/ghl/config.py` are correct for the Spa location (currently config holds Aesthetics IDs — resolve before import)
- [ ] Custom fields created in GHL for: `zoho_id`, `zoho_source`, `zoho_created_at`, `zoho_owner`, `followup_count`, `task_type`, `task_outcome`, `priority_score`, `lifetime_value`
- [ ] Tag `zoho_migrated_2026_04` created in GHL (for rollback)
- [ ] Tag `needs_reengagement` created in GHL (for dormant flag)

### Workspace
- [ ] `.tmp/migration/spa/` subfolders: `01-raw/`, `02-cleaned/`, `03-mapped/`, `04-ready/`, `05-reports/`
- [ ] `.tmp/migration/aesthetics/` subfolders: `01-raw/`, `02-cleaned/`, `03-mapped/`, `04-ready/`, `05-reports/`
- [ ] `.tmp/migration/slimming/` subfolders: `01-raw/`, `02-cleaned/`, `03-mapped/`, `04-ready/`, `05-reports/`
- [ ] `Tools/migration/` exists and is importable as a module
- [ ] Disk: ≥ 5 GB free (3 brands × Zoho bulk exports)
- [ ] Python 3.11+, `httpx`, `phonenumbers`, `email-validator`, `python-dotenv`, `tqdm` installed

### Sign-offs
- [ ] Human (Mert) has approved `spa/04-ready/*.json` before Phase 4 runs
- [ ] Human (Mert) has reviewed pipeline stage best-fit map (`spa/03-mapped/stage_map.json`) and confirmed or corrected mappings
- [ ] Sales (Mert acting as Sales Agent) has signed off the pipeline stage mapping
- [ ] Marketing (Mert acting as Marketing Agent) has signed off the tag/list mapping
- [ ] Aesthetics + Slimming extracts confirmed saved — will import once GHL sub-accounts are live

---

## 3. File Structure Created by This Plan

```
Tools/migration/
  __init__.py
  zoho_extractor.py          # Agent 1 — full Zoho pull via MCP / REST
  pipeline_analyzer.py       # Agent 2 — pipeline & opportunity analysis
  tag_segment_analyzer.py    # Agent 3 — marketing tag/list analysis
  data_cleaner.py            # Agent 4 — dedup + normalize + drop
  field_mapper.py            # Agent 4 — Zoho → GHL schema transform
  ghl_importer.py            # Agent 4 — batched import with rate limiting
  migration_verifier.py      # Agent 4 — post-import integrity checks
  run_migration.py           # Orchestrator
  phone_utils.py             # Shared E.164 helpers
  dedup_utils.py             # Shared merge logic

.tmp/migration/
  01-raw/
    contacts.json            # All Zoho Contacts module records
    leads.json               # All Zoho Leads module records (unconverted)
    deals.json               # All Zoho Deals module records
    notes.json               # All Zoho Notes (joined to parent records)
    tasks.json               # All Zoho Tasks
    tags.json                # Tag taxonomy per module
    users.json               # Zoho users (for owner → GHL user mapping)
    schema/
      contacts_fields.json   # Field metadata from zoho_get_fields
      leads_fields.json
      deals_fields.json
      pipelines.json
  02-cleaned/
    contacts_clean.json      # After dedup, phone normalization, drop rules
    deals_clean.json         # After FK repair (contact_id → cleaned id)
    notes_clean.json
    tasks_clean.json
  03-mapped/
    contacts_ghl.json        # GHL-shaped contact payloads
    opportunities_ghl.json   # GHL-shaped opportunity payloads
    notes_ghl.json
    tasks_ghl.json
    tag_map.json             # Zoho tag → GHL tag mapping
    stage_map.json           # Zoho stage → GHL stage mapping
    custom_field_map.json    # Zoho custom field → GHL custom field mapping
  04-ready/                  # HUMAN APPROVES THESE BEFORE PHASE 4
    contacts_import.json     # Final batched import payload
    opportunities_import.json
    notes_import.json
    tasks_import.json
    APPROVAL.txt             # Human writes "APPROVED <date> <initials>" here
  05-reports/
    dedup_report.csv         # Which records were merged and why
    drop_report.csv          # Which records were dropped and why
    mapping_report.csv       # Field-level mapping audit
    import_report.csv        # Per-record import result (success/fail/reason)
    verification_report.md   # Final integrity check summary

docs/plans/
  2026-04-21-zoho-to-ghl-spa-migration.md   # This file
```

---

## 4. Data Cleaning Specification

This is the contract every record must pass before landing in `04-ready/`.

### 4.1 Deduplication rules

```python
# dedup_utils.py (conceptual)

# PRIMARY KEY: email (lowercase, stripped of surrounding whitespace)
# SECONDARY KEY: phone (normalized E.164, see §4.2)
# TERTIARY (tiebreak only): first_name + last_name + created_at bucket

def merge_duplicates(records: list[dict]) -> dict:
    """
    Merge a group of duplicate records into one canonical record.

    Strategy:
      1. For each field, pick the value from the record with the most recent
         `Modified_Time` (Zoho) that has a non-empty value for that field.
      2. Accumulate: tags (union), notes (concat), tasks (concat), deals (list).
      3. Preserve all Zoho IDs in a `zoho_ids` list custom field for audit.
      4. `updated_at` on the merged record = max(modified_time across group).
    """
    # Sort descending by Modified_Time
    sorted_records = sorted(records, key=lambda r: r["Modified_Time"], reverse=True)
    canonical = {}
    for rec in sorted_records:
        for field, value in rec.items():
            if value in (None, "", []) :
                continue
            if field in ("Tag", "tags"):
                canonical.setdefault("tags", set()).update(value or [])
            elif field in ("id", "Zoho_Id"):
                canonical.setdefault("zoho_ids", []).append(value)
            elif field not in canonical:
                canonical[field] = value
    canonical["tags"] = sorted(canonical.get("tags", set()))
    return canonical
```

### 4.2 Phone normalization

```python
# phone_utils.py

import re
import phonenumbers

MALTA_CC = "+356"

def normalize_phone(raw: str | None) -> str | None:
    """
    Return E.164-formatted phone, or None if unusable.

    Rules:
      - Strip spaces, dashes, dots, parentheses.
      - If starts with '+', validate via phonenumbers; must match ^\+[1-9]\d{1,14}$.
      - If starts with '00', replace with '+'.
      - If 7 or 8 digits (no country code), assume Malta → prepend +356.
      - Otherwise: return None (logged to drop_report with reason=UNPARSEABLE_PHONE).
    """
    if not raw:
        return None
    cleaned = re.sub(r"[\s\-\.\(\)]", "", raw)
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if cleaned.startswith("+"):
        candidate = cleaned
    elif re.fullmatch(r"\d{7,8}", cleaned):
        candidate = MALTA_CC + cleaned
    else:
        return None
    try:
        parsed = phonenumbers.parse(candidate, None)
        if not phonenumbers.is_valid_number(parsed):
            return None
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except phonenumbers.NumberParseException:
        return None
```

### 4.3 Drop rules

Applied in this order (first match wins, record dropped, reason logged to `drop_report.csv`):

| # | Rule | Reason code |
|---|---|---|
| 1 | Has phone AND no email | `DROP_PHONE_ONLY` |
| 2 | Email is empty or fails `email_validator.validate_email` | `DROP_INVALID_EMAIL` |
| 3 | Email domain in known-bogus list (`example.com`, `test.com`, `noemail.*`) | `DROP_BOGUS_EMAIL` |
| 4 | Email matches internal staff domain (to be confirmed) | `DROP_INTERNAL_STAFF` |
| 5 | Record marked `Email_Opt_Out=true` AND `Do_Not_Call=true` AND no open deal | `DROP_FULL_OPT_OUT` (optional — flag for human review) |

Records that pass → land in `02-cleaned/contacts_clean.json`.

### 4.4 Email normalization
- Lowercase
- Strip whitespace
- Remove dots in Gmail local-part? **No** (this over-normalizes and merges people who aren't the same person). Leave Gmail addresses as-is.

---

## 5. Field Mapping: Zoho → GHL

### 5.1 Contact fields

| Zoho (Contacts/Leads) | GHL Contact | Notes |
|---|---|---|
| `First_Name` | `firstName` | trim |
| `Last_Name` | `lastName` | trim, required; if missing, set to `"(no last name)"` |
| `Email` | `email` | lowercased, validated |
| `Phone` / `Mobile` | `phone` | E.164; prefer `Mobile` if both present |
| `Mailing_Street` | `address1` | |
| `Mailing_City` | `city` | |
| `Mailing_State` | `state` | |
| `Mailing_Country` | `country` | ISO-2 preferred |
| `Mailing_Zip` | `postalCode` | |
| `Lead_Source` | `source` | fallback: `"zoho_migration"` |
| `Created_Time` | custom field `zoho_created_at` | ISO8601 |
| `Modified_Time` | custom field `zoho_updated_at` | |
| `Owner.name` | custom field `zoho_owner` | mapped to GHL user ID if match found, else free text |
| `Tag` (list) | `tags` (list) | translated via `tag_map.json` |
| `Description` | `companyName`? **No** — store as first `contactNote` on the contact |
| `id` (Zoho record ID) | custom field `zoho_id` | for audit |
| `Language` | custom field `preferred_language` | Malta audience: en/mt/it/fr/de/es |
| `Date_of_Birth` | `dateOfBirth` | |
| `Email_Opt_Out` | `dnd` (if true) | also add tag `email_opted_out` |
| `Do_Not_Call` | adds tag `do_not_call` | |

Every migrated contact gets these tags appended: `zoho_migrated_2026_04`, `source:zoho_spa`.

### 5.2 Opportunity / Deal fields

| Zoho Deal | GHL Opportunity | Notes |
|---|---|---|
| `Deal_Name` | `name` | |
| `Stage` | `pipelineStageId` | via `stage_map.json` (see §5.5) |
| `Amount` | `monetaryValue` | integer EUR; if Zoho stores currency, convert to EUR |
| `Closing_Date` | custom field `expected_close_date` | GHL opportunities don't have first-class close date; store in custom field + set `status=won/lost` if closed |
| `Pipeline` | `pipelineId` | single Spa pipeline per `config.py::PIPELINE_ID` |
| `Contact_Name.id` | `contactId` | must resolve to migrated contact's GHL ID |
| `Owner.name` | `assignedTo` | GHL user ID if matched |
| `Created_Time` | custom field `zoho_created_at` | |
| `Description` | stored as first opportunity note | |

### 5.3 Note fields

| Zoho Note | GHL Note | Notes |
|---|---|---|
| `Note_Content` | `body` | |
| `Created_Time` | `createdAt` | pass-through |
| `Owner.name` | `userId` | GHL user ID if matched, else blank |
| `Parent_Id` | `contactId` | resolved via `zoho_id → ghl_contact_id` map |

Notes attached to deals → attached to the corresponding GHL opportunity's contact, with prefix `[Deal: {deal_name}]` in the body.

### 5.4 Task fields

| Zoho Task | GHL Task | Notes |
|---|---|---|
| `Subject` | `title` | |
| `Due_Date` | `dueDate` | ISO8601 |
| `Status` | `completed` | `Completed` → true; others → false |
| `Owner.name` | `assignedTo` | |
| `Description` | `body` | |
| `What_Id` / `Who_Id` | `contactId` | resolve via zoho_id map |

Tasks older than 90 days with `Status != Completed` are marked completed on import (set `completedAt = due_date`). Reason: avoid flooding the live setter queue with stale tasks.

### 5.5 Pipeline stage mapping (Sales Agent to confirm)

| Zoho Stage (Spa) | GHL Stage | Opportunity Status |
|---|---|---|
| `Qualification` / `Enquiry` | `🌱 New Leads` | open |
| `Contacted` / `Attempted Contact` | `📞 Contacted` | open |
| `No Show` | `🚫 No Show` | open |
| `Nurture` / `Long-Term Follow-up` | `🌿 Nurturing` | open |
| `Closed Won` / `Booked` | `✅ Booking Won` | won |
| `Closed Lost` / `Not Interested` | `❌ Booking Lost` | lost |
| anything else | `🌱 New Leads` + tag `needs_stage_review` | open |

Final authoritative map lands in `.tmp/migration/03-mapped/stage_map.json` after Task 2.1.

### 5.6 Custom field creation

Before import, ensure these custom fields exist in the GHL Spa location. Create via `mcp__ghl__ghl_create_custom_field` if missing:

| Field key | Type | Purpose |
|---|---|---|
| `zoho_id` | TEXT | Original Zoho record ID (contacts) |
| `zoho_deal_id` | TEXT | Original Zoho deal ID (opportunities) |
| `zoho_created_at` | DATE | Original creation timestamp |
| `zoho_updated_at` | DATE | Original last-modified timestamp |
| `zoho_owner` | TEXT | Original Zoho owner display name |
| `preferred_language` | DROPDOWN | en,mt,it,fr,de,es |
| `lifetime_value` | MONETARY | Sum of won deal amounts |
| `expected_close_date` | DATE | Zoho `Closing_Date` |
| `followup_count` | NUMBER | already exists (see `config.py`) |
| `task_type` | TEXT | already exists |
| `task_outcome` | DROPDOWN | already exists |
| `priority_score` | NUMBER | already exists |

---

## 6. Phase 1 — Extraction (Data Agent) — 3 PARALLEL SUBAGENTS

> **Parallelism:** Dispatch 3 subagents simultaneously — one per brand — each running Tasks 1.1–1.4 against their brand's Zoho MCP. They write to separate brand folders and never collide.

| Subagent | Zoho MCP | Output folder |
|---|---|---|
| Spa Extractor | `mcp__zoho-crm-spa__*` | `.tmp/migration/spa/` |
| Aesthetics Extractor | `mcp__zoho-crm-aesthetics__*` | `.tmp/migration/aesthetics/` |
| Slimming Extractor | `mcp__zoho-crm-slimming__*` | `.tmp/migration/slimming/` |

Each subagent runs the same Tasks 1.1–1.4 below, substituting `{brand}` with their brand name and using their brand's MCP tools.

### Task 1.1: Bootstrap the migration module

**Agent Role:** Data
**Files:**
- Create: `Tools/migration/__init__.py` (empty)
- Create: `Tools/migration/phone_utils.py` (per §4.2)
- Create: `Tools/migration/dedup_utils.py` (per §4.1)
- Create: `.tmp/migration/{spa,aesthetics,slimming}/{01-raw,02-cleaned,03-mapped,04-ready,05-reports}/`

**Steps:**
1. `mkdir -p Tools/migration .tmp/migration/spa/{01-raw/schema,02-cleaned,03-mapped,04-ready,05-reports} .tmp/migration/aesthetics/{01-raw/schema,02-cleaned,03-mapped,04-ready,05-reports} .tmp/migration/slimming/{01-raw/schema,02-cleaned,03-mapped,04-ready,05-reports}`
2. Write `phone_utils.py` exactly as specified in §4.2.
3. Write `dedup_utils.py` exactly as specified in §4.1.
4. Add `phonenumbers==8.13.50`, `email-validator==2.2.0`, `tqdm==4.66.5` to `CRM/ghl/requirements.txt` and `pip install -r CRM/ghl/requirements.txt`.
5. Smoke test: `python -c "from Tools.migration.phone_utils import normalize_phone; assert normalize_phone('79 12 34 56') == '+35679123456'; assert normalize_phone('bogus') is None; print('ok')"`

**Output:** Module bootstrap; no data yet.
**Handoff:** Data Agent can now import helpers for Task 1.2.

### Task 1.2: Discover Zoho schema

**Agent Role:** Data
**Files:**
- Create: `Tools/migration/zoho_extractor.py`
- Output: `.tmp/migration/01-raw/schema/*.json`

**Steps:**
1. For each module in `["Contacts", "Leads", "Deals", "Notes", "Tasks"]`, call the Zoho MCP field introspection:
   ```python
   # Pseudocode — in practice Data Agent calls via MCP tool
   mcp__zoho-crm-spa__zoho_list_modules()                    # confirm modules exist
   mcp__zoho-crm-spa__zoho_get_fields(module="Contacts")     # full field metadata
   mcp__zoho-crm-spa__zoho_get_layouts(module="Contacts")    # layout-specific fields
   mcp__zoho-crm-spa__zoho_get_pipelines()                   # Deals pipeline stages
   mcp__zoho-crm-spa__zoho_list_tags()                       # tag taxonomy
   mcp__zoho-crm-spa__zoho_list_users()                      # owner mapping
   ```
2. Persist each response verbatim to `.tmp/migration/01-raw/schema/{module}_fields.json`.
3. Generate a human-readable schema summary at `.tmp/migration/01-raw/schema/SUMMARY.md` with: module name, record count (from `zoho_list_records limit=1` meta), custom field list, required fields.

**Output:**
```
.tmp/migration/01-raw/schema/
  contacts_fields.json
  leads_fields.json
  deals_fields.json
  notes_fields.json
  tasks_fields.json
  pipelines.json
  tags.json
  users.json
  SUMMARY.md
```

**Handoff:** Field Mapper uses these files in Task 3.2.

### Task 1.3: Full extraction — Contacts

**Agent Role:** Data
**Files:**
- Modify: `Tools/migration/zoho_extractor.py`
- Output: `.tmp/migration/01-raw/contacts.json`

**Steps:**
1. Use `mcp__zoho-crm-spa__zoho_bulk_read` for the Contacts module (it scales to 200k records and honors rate limits). Page size 200, `fields="All"`.
2. Stream each page's records into a JSONL file, then convert to a single JSON array at the end for convenience.
3. Handle pagination:
   ```python
   page = 1
   while True:
       resp = zoho_list_records(module="Contacts", page=page, per_page=200, fields="All")
       records.extend(resp["data"])
       if not resp["info"]["more_records"]:
           break
       page += 1
   ```
4. Also pull related lists per contact in a second pass only if needed (notes/tasks/deals are extracted separately in their own modules — cheaper).
5. Checksum: write `contacts_count.txt` with total record count for downstream verification.

**Expected output:** `.tmp/migration/01-raw/contacts.json` with shape:
```json
[
  {
    "id": "3652000000123456",
    "First_Name": "Jane",
    "Last_Name": "Borg",
    "Email": "jane.borg@example.mt",
    "Phone": "79 123 456",
    "Mobile": "+356 7912 3456",
    "Mailing_City": "Valletta",
    "Lead_Source": "Facebook Ads",
    "Tag": [{"name": "spa_signature_2025"}],
    "Created_Time": "2025-06-12T14:22:30+02:00",
    "Modified_Time": "2025-11-03T09:15:00+01:00",
    "Owner": {"id": "3652000000001", "name": "Nicole"},
    "Email_Opt_Out": false,
    "Do_Not_Call": false
  }
]
```

**Handoff:** Cleaner (Task 3.1) and Tag/Segment Analyzer (Task 2.2) read this file.

### Task 1.4: Full extraction — Leads, Deals, Notes, Tasks

**Agent Role:** Data
**Files:** Modify: `Tools/migration/zoho_extractor.py`
**Steps:** Repeat Task 1.3's pattern for each module. Notes and Tasks carry a parent pointer (`Parent_Id` / `What_Id` / `Who_Id`) — preserve them verbatim.

**Output:**
- `.tmp/migration/01-raw/leads.json`
- `.tmp/migration/01-raw/deals.json`
- `.tmp/migration/01-raw/notes.json`
- `.tmp/migration/01-raw/tasks.json`
- `.tmp/migration/01-raw/EXTRACTION_REPORT.md` (record counts per module, extraction duration, any pages that errored)

**Handoff:** Phase 2 agents can now start in parallel on `01-raw/` artifacts.

---

## 7. Phase 2 — Analysis (Sales Agent + Marketing Agent in parallel)

These two tasks share no state with each other and can run simultaneously.

### Task 2.1: Pipeline & opportunity analysis

**Agent Role:** Sales
**Files:**
- Create: `Tools/migration/pipeline_analyzer.py`
- Output: `.tmp/migration/03-mapped/stage_map.json`, `.tmp/migration/05-reports/pipeline_analysis.md`

**Steps:**
1. Load `.tmp/migration/01-raw/deals.json` and `.tmp/migration/01-raw/schema/pipelines.json`.
2. Group deals by `Stage` and compute: count, total `Amount`, avg `Amount`, median days-in-stage, conversion rate to `Closed Won`.
3. Fetch live GHL pipeline stages via `mcp__ghl__get_pipelines` to get the actual current stage names + IDs for the Spa sub-account. Do NOT rely on hardcoded IDs in `config.py` (those are Aesthetics values).
4. Produce a **best-fit mapping** by comparing Zoho stage names to GHL stage names using this algorithm:
   - Step 1: Exact match (case-insensitive) — use it
   - Step 2: Semantic match — normalize both names (remove emoji, lowercase, strip "lead"/"deal"/"stage") and fuzzy-match
   - Step 3: Position match — if no name match, map by ordinal position (Zoho stage #3 → GHL stage #3)
   - Step 4: Any stage that still has no confident match → flag as `NEEDS_REVIEW` in `stage_map.json`
   ```json
   {
     "Qualification":   {"ghl_stage": "New Lead",       "ghl_stage_id": "abc123", "status": "open",  "match_method": "semantic"},
     "Proposal Sent":   {"ghl_stage": "Proposal",       "ghl_stage_id": "def456", "status": "open",  "match_method": "exact"},
     "Closed Won":      {"ghl_stage": "Won",             "ghl_stage_id": "ghi789", "status": "won",   "match_method": "semantic"},
     "Closed Lost":     {"ghl_stage": "Lost",            "ghl_stage_id": "jkl012", "status": "lost",  "match_method": "semantic"},
     "Unknown Stage":   {"ghl_stage": null,              "ghl_stage_id": null,     "status": "open",  "match_method": "NEEDS_REVIEW"}
   }
   ```
   Any `NEEDS_REVIEW` entries get tag `needs_stage_review` on the contact — human resolves before go-live.
4. Flag high-value active opportunities: `Stage not in [Closed Won, Closed Lost]` AND `Amount >= 200` AND `Modified_Time within last 60 days`. Export to `.tmp/migration/05-reports/high_value_active.csv` with columns: `zoho_deal_id, contact_email, stage, amount, modified_time, owner`. These get priority import.
5. Write `pipeline_analysis.md` with: deal counts per stage, proposed mapping, high-value contacts count, any stages that don't map cleanly (these land in `needs_stage_review` tag).

**Output:**
- `.tmp/migration/03-mapped/stage_map.json`
- `.tmp/migration/05-reports/pipeline_analysis.md`
- `.tmp/migration/05-reports/high_value_active.csv`

**Handoff:** Field Mapper (Task 3.3) reads `stage_map.json`. Human reviews `pipeline_analysis.md` before Phase 3.

### Task 2.2: Tag, list, and segment analysis

**Agent Role:** Marketing
**Files:**
- Create: `Tools/migration/tag_segment_analyzer.py`
- Output: `.tmp/migration/03-mapped/tag_map.json`, `.tmp/migration/05-reports/marketing_analysis.md`

**Steps:**
1. Load `.tmp/migration/01-raw/contacts.json`, `leads.json`, and `schema/tags.json`.
2. Build a tag frequency histogram. Split into:
   - **Keep (transactional):** tags indicating service category, source, or campaign (e.g., `facial_glow_reset`, `couples_retreat_2025`, `source_meta`). Keep verbatim, lowercase + underscores.
   - **Normalize (rename):** tags with inconsistent casing/spacing (e.g., `Hot Stone` → `hot_stone`). Log each rename in `tag_map.json`.
   - **Drop (operational junk):** tags like `FollowUp1`, `Called`, `NoAnswer` that duplicate GHL pipeline stage semantics. These become pipeline stage moves, not tags.
3. Add system tags to every migrated contact: `zoho_migrated_2026_04`, `source:zoho_spa`.
4. Identify re-engagement candidates: `Last_Activity_Time > 120 days ago` AND `Email_Opt_Out=false` AND has `Closed Won` deal in past 24 months. Tag them `needs_reengagement` — the email-manager skill will pick them up post-migration.
5. Preserve opt-in / opt-out state per channel:
   - `Email_Opt_Out=true` → GHL `dnd=true` (email channel) + tag `email_opted_out`
   - `Do_Not_Call=true` → tag `do_not_call` (GHL has no per-channel DND — channel-specific DND via `dndSettings` on contact if plan allows)
6. Write `marketing_analysis.md` with: top 20 tags with counts, proposed renames, drop list, re-engagement candidate count, opt-out count.

**Output:**
- `.tmp/migration/03-mapped/tag_map.json`
- `.tmp/migration/05-reports/marketing_analysis.md`
- `.tmp/migration/05-reports/reengagement_candidates.csv`

**Handoff:** Field Mapper (Task 3.3) reads `tag_map.json`.

---

## 8. Phase 3 — Cleaning & Transformation (CRM Agent)

### Task 3.1: Deduplicate and clean contacts

**Agent Role:** CRM
**Files:**
- Create: `Tools/migration/data_cleaner.py`
- Input: `.tmp/migration/01-raw/contacts.json`, `leads.json`
- Output: `.tmp/migration/02-cleaned/contacts_clean.json`, `.tmp/migration/05-reports/dedup_report.csv`, `.tmp/migration/05-reports/drop_report.csv`

**Steps:**
1. Load contacts + leads, union into a single list tagged with source (`_origin_module`).
2. For each record:
   - Normalize email: `email.strip().lower()`. Run `email_validator.validate_email(email, check_deliverability=False)`. On failure → drop with reason `DROP_INVALID_EMAIL`.
   - Normalize phone: `phone_utils.normalize_phone(raw_phone_or_mobile)`. Prefer `Mobile` over `Phone` when both present. If result is None AND email is missing → drop with reason `DROP_PHONE_ONLY`. If only phone is unparseable but email valid → keep record, set phone=null.
   - Apply drop rules §4.3 in order. Log every drop to `drop_report.csv` with columns: `zoho_id, email, phone_raw, reason, module`.
3. Group surviving records by primary key (email). Within each group call `dedup_utils.merge_duplicates()`. Log merges to `dedup_report.csv` with columns: `canonical_email, merged_zoho_ids, fields_conflicted, winning_modified_time`.
4. Second pass: group the survivors by normalized phone (for the subset with a phone). If two canonical email-records share a phone, flag both with tag `phone_collision_review` and DO NOT auto-merge — human reviews.
5. Persist the cleaned canonical list to `02-cleaned/contacts_clean.json`. Structure:
   ```json
   [
     {
       "zoho_ids": ["3652000000123456", "3652000000987654"],
       "email": "jane.borg@example.mt",
       "phone": "+35679123456",
       "first_name": "Jane",
       "last_name": "Borg",
       "city": "Valletta",
       "country": "MT",
       "source": "Facebook Ads",
       "tags_raw": ["spa_signature_2025"],
       "owner_zoho_name": "Nicole",
       "created_at": "2025-06-12T14:22:30+02:00",
       "updated_at": "2025-11-03T09:15:00+01:00",
       "email_opt_out": false,
       "do_not_call": false,
       "language": "en"
     }
   ]
   ```

**Expected counts (adjust after real extraction):** Sanity band — if `drops > 30%` of input, HALT and ask human before continuing. A high drop rate likely means phone-only records are abnormally common and warrants review.

**Output:**
- `.tmp/migration/02-cleaned/contacts_clean.json`
- `.tmp/migration/05-reports/dedup_report.csv`
- `.tmp/migration/05-reports/drop_report.csv`

**Handoff:** Task 3.2 (FK repair for deals/notes/tasks).

### Task 3.2: Repair foreign keys on deals/notes/tasks

**Agent Role:** CRM
**Files:**
- Modify: `Tools/migration/data_cleaner.py`
- Input: `02-cleaned/contacts_clean.json`, `01-raw/{deals,notes,tasks}.json`
- Output: `02-cleaned/{deals,notes,tasks}_clean.json`

**Steps:**
1. Build index: `zoho_id → canonical_email` from `contacts_clean.json[*].zoho_ids`.
2. For each deal/note/task, resolve its parent (`Contact_Name.id`, `Parent_Id`, `Who_Id`, `What_Id`) via the index. If unresolvable (parent was dropped or never existed), log to `05-reports/orphan_report.csv` and drop the child record.
3. For deals: if the Zoho `Contact_Name.id` and `Account_Name.id` both exist, prefer Contact. Carry `Amount`, `Stage`, `Closing_Date`, `Created_Time`, `Owner`, `Description` forward into `deals_clean.json`.
4. For notes: concat `Note_Title + "\n\n" + Note_Content` if title is informative, else just `Note_Content`. Attach `parent_email = canonical_email`.
5. For tasks: same as notes. Auto-complete stale open tasks (>90 days) per §5.4.

**Output:**
- `.tmp/migration/02-cleaned/deals_clean.json`
- `.tmp/migration/02-cleaned/notes_clean.json`
- `.tmp/migration/02-cleaned/tasks_clean.json`
- `.tmp/migration/05-reports/orphan_report.csv`

**Handoff:** Task 3.3.

### Task 3.3: Field mapping — build GHL payloads

**Agent Role:** CRM
**Files:**
- Create: `Tools/migration/field_mapper.py`
- Inputs: `02-cleaned/*.json`, `03-mapped/{tag_map,stage_map,custom_field_map}.json`
- Output: `03-mapped/{contacts,opportunities,notes,tasks}_ghl.json`

**Steps:**
1. Ensure all required GHL custom fields exist (§5.6). Call `mcp__ghl__get_location_custom_fields` once; diff against required; create missing via `mcp__ghl__ghl_create_custom_field`. Persist resulting field IDs to `03-mapped/custom_field_map.json`:
   ```json
   {"zoho_id": "abc123", "zoho_created_at": "def456", ...}
   ```
2. Build GHL contact payloads from `contacts_clean.json`:
   ```python
   payload = {
       "locationId": GHL_LOCATION_ID,
       "firstName": rec["first_name"],
       "lastName": rec["last_name"] or "(no last name)",
       "email": rec["email"],
       "phone": rec["phone"],                  # optional
       "address1": rec.get("address"),
       "city": rec.get("city"),
       "state": rec.get("state"),
       "country": rec.get("country", "MT"),
       "postalCode": rec.get("postal_code"),
       "source": rec.get("source") or "zoho_migration",
       "tags": translate_tags(rec["tags_raw"]) + ["zoho_migrated_2026_04", "source:zoho_spa"],
       "dnd": rec["email_opt_out"],
       "customFields": [
           {"id": FIELD_IDS["zoho_id"],         "value": rec["zoho_ids"][0]},
           {"id": FIELD_IDS["zoho_created_at"], "value": rec["created_at"]},
           {"id": FIELD_IDS["zoho_updated_at"], "value": rec["updated_at"]},
           {"id": FIELD_IDS["zoho_owner"],      "value": rec["owner_zoho_name"]},
           {"id": FIELD_IDS["preferred_language"], "value": rec.get("language", "en")},
       ],
   }
   ```
3. Build opportunity payloads from `deals_clean.json`:
   ```python
   payload = {
       "pipelineId":      PIPELINE_ID,
       "pipelineStageId": STAGE_MAP[deal["Stage"]]["ghl_stage_id"],
       "status":          STAGE_MAP[deal["Stage"]]["status"],
       "name":            deal["Deal_Name"],
       "monetaryValue":   int(round(deal["Amount"] or 0)),
       "contactEmail":    deal["parent_email"],     # resolved at import time
       "customFields":    [{"id": FIELD_IDS["zoho_deal_id"], "value": deal["id"]}, ...],
       "source":          deal.get("Lead_Source") or "zoho_migration",
   }
   ```
4. Build note and task payloads — carry `parent_email` for resolution at import time.
5. Write `05-reports/mapping_report.csv`: one row per source record with columns `module, zoho_id, email_or_parent, status (mapped/failed), reason_if_failed`.

**Output:**
- `.tmp/migration/03-mapped/contacts_ghl.json`
- `.tmp/migration/03-mapped/opportunities_ghl.json`
- `.tmp/migration/03-mapped/notes_ghl.json`
- `.tmp/migration/03-mapped/tasks_ghl.json`
- `.tmp/migration/03-mapped/custom_field_map.json`
- `.tmp/migration/05-reports/mapping_report.csv`

**Handoff:** Task 3.4.

### Task 3.4: Final import payload assembly + human approval gate

**Agent Role:** CRM
**Files:**
- Output: `.tmp/migration/04-ready/*.json`, `.tmp/migration/04-ready/APPROVAL.txt`

**Steps:**
1. Copy the four `03-mapped/*_ghl.json` files into `04-ready/{contacts,opportunities,notes,tasks}_import.json`.
2. Generate a summary `04-ready/MIGRATION_SUMMARY.md`:
   - Total input vs output record counts per module
   - Top 10 tag mappings
   - Stage mapping confirmation
   - Total monetary value being migrated
   - Sample of 10 random contacts, 5 random opportunities for spot-check
3. Write a blocking sentinel: `04-ready/APPROVAL.txt` with contents:
   ```
   AWAITING HUMAN APPROVAL
   To approve, replace this file's contents with: APPROVED <YYYY-MM-DD> <initials>
   ```
4. `run_migration.py` refuses to proceed past Phase 4 unless `APPROVAL.txt` begins with `APPROVED`.

**Output:** `04-ready/` fully populated, migration halts awaiting human.
**Handoff:** Human reviews `MIGRATION_SUMMARY.md` + spot-checks JSON, edits `APPROVAL.txt` to proceed.

---

## 9. Phase 4 — Import (CRM Agent, post-approval)

### Task 4.1: Import contacts (idempotent upsert)

**Agent Role:** CRM
**Files:**
- Create: `Tools/migration/ghl_importer.py`
- Input: `04-ready/contacts_import.json`
- Output: `.tmp/migration/05-reports/import_report_contacts.csv`, `.tmp/migration/05-reports/email_to_ghl_id.json`

**Steps:**
1. Read `APPROVAL.txt`. If first line is not `APPROVED`, raise `RuntimeError("Migration not approved")`.
2. For each contact, use **upsert** to safely re-run: `mcp__ghl__upsert_contact` (or POST `/contacts/upsert`). The endpoint matches on email+phone+locationId and preserves existing live data.
3. Rate-limit via token bucket: GHL documented limit ≈ 100 requests / 10 seconds per location. Use a bucket of 90 req / 10 s to stay safely under.
   ```python
   # ghl_importer.py excerpt
   import time, collections
   class TokenBucket:
       def __init__(self, rate: int, per_sec: int):
           self.rate, self.per = rate, per_sec
           self.calls = collections.deque()
       def take(self):
           now = time.time()
           while self.calls and now - self.calls[0] > self.per:
               self.calls.popleft()
           if len(self.calls) >= self.rate:
               time.sleep(self.per - (now - self.calls[0]))
           self.calls.append(time.time())
   bucket = TokenBucket(rate=90, per_sec=10)
   ```
4. On 429 response: exponential backoff with jitter (1s, 2s, 4s, 8s — 4 retries). On 5xx: retry 3x. On 4xx (non-429): log and move on.
5. Collect `{email: ghl_contact_id}` mapping in `email_to_ghl_id.json` — opportunities/notes/tasks need it.
6. Per-record result to `import_report_contacts.csv`: `email, ghl_id, status (created/updated/failed), reason, retries, latency_ms`.
7. Run in batches of 500 contacts with a checkpoint file (`.tmp/migration/04-ready/contacts_cursor.txt`) recording the last-completed index. Re-running picks up where it left off.

**Expected:** if input=N contacts → output rows in `import_report_contacts.csv` = N; `status=failed` count ≤ 0.5%.
**Handoff:** `email_to_ghl_id.json` used by Tasks 4.2–4.4.

### Task 4.2: Import opportunities

**Agent Role:** CRM
**Files:**
- Modify: `Tools/migration/ghl_importer.py`
- Input: `04-ready/opportunities_import.json`, `05-reports/email_to_ghl_id.json`

**Steps:**
1. For each opportunity payload, resolve `contactEmail` → `contactId` via `email_to_ghl_id.json`. If missing, skip and log to `import_report_opportunities.csv` with reason `PARENT_NOT_FOUND`.
2. Call `mcp__ghl__upsert_opportunity` when available (matches on contactId + name + pipelineId). Otherwise use `mcp__ghl__create_opportunity`. For already-imported opportunities on re-run, the `zoho_deal_id` custom field prevents duplicates — do a pre-check via `mcp__ghl__search_opportunities` filtered by this custom field.
3. After create: if `status=won` or `lost`, call `mcp__ghl__update_opportunity_status` to move it to terminal status.
4. Rate-limit per §4.1 of Task 4.1.

**Output:** `.tmp/migration/05-reports/import_report_opportunities.csv`, `.tmp/migration/05-reports/deal_to_ghl_opp_id.json`
**Handoff:** `deal_to_ghl_opp_id.json` (in case notes reference deals).

### Task 4.3: Import notes

**Agent Role:** CRM
**Files:** Modify: `Tools/migration/ghl_importer.py`
**Steps:**
1. Resolve `parent_email` → `contactId`.
2. Call `mcp__ghl__create_contact_note`. Set `userId` to mapped GHL user ID if resolvable from the Zoho owner name.
3. Rate-limit.
4. Log to `import_report_notes.csv`.

**Output:** `.tmp/migration/05-reports/import_report_notes.csv`

### Task 4.4: Import tasks

**Agent Role:** CRM
**Files:** Modify: `Tools/migration/ghl_importer.py`
**Steps:**
1. Resolve `parent_email` → `contactId`.
2. Call `mcp__ghl__create_contact_task`. Set `completed=true` for auto-completed stale tasks.
3. Rate-limit.
4. Log to `import_report_tasks.csv`.

**Output:** `.tmp/migration/05-reports/import_report_tasks.csv`

---

## 10. Phase 5 — Verification (all agents verify their domain)

### Task 5.1: CRM Agent — integrity sweep

**Agent Role:** CRM
**Files:**
- Create: `Tools/migration/migration_verifier.py`
- Output: `.tmp/migration/05-reports/verification_report.md`

**Steps:**
1. **Count check.** Row-count parity per module:
   | Source | Expected | Actual (GHL query) |
   |---|---|---|
   | cleaned contacts | N | `search_contacts` tag=`zoho_migrated_2026_04` |
   | opportunities | M | `search_opportunities` by pipeline + custom field `zoho_deal_id != null` |
   | notes | P | sum of `get_contact_notes` for migrated contacts |
   | tasks | Q | sum of `get_contact_tasks` |
   Delta > 1% on any row → flag as P1.
2. **Sample check.** Pick 20 random `email_to_ghl_id` entries. For each:
   - `mcp__ghl__get_contact(ghl_id)` — confirm email, phone (E.164), firstName, lastName, tags contain `zoho_migrated_2026_04`.
   - Compare to source record in `01-raw/contacts.json` by Zoho ID.
3. **PII check.** Assert no phone number in GHL for any contact dropped as `DROP_PHONE_ONLY`.
4. **Duplicate check.** For each email in `email_to_ghl_id`, call `mcp__ghl__get_duplicate_contact` to confirm no surprise duplicates were created.
5. **Opt-out honoring.** For every contact with `email_opt_out=true` in source, confirm `dnd=true` in GHL.

### Task 5.2: Sales Agent — pipeline integrity

**Agent Role:** Sales
**Steps:**
1. For each stage in `stage_map.json`, query `mcp__ghl__search_opportunities` filtered by stage ID. Compare count to `pipeline_analysis.md`.
2. Spot-check 10 high-value opportunities from `high_value_active.csv` — confirm they land in the correct stage with correct monetary value.
3. Flag any opportunity where `status != "won"` but stage is `✅ Booking Won` (or reverse) — write to `05-reports/stage_status_mismatches.csv`.

### Task 5.3: Marketing Agent — tag/opt-in integrity

**Agent Role:** Marketing
**Steps:**
1. For the top 20 tags in `marketing_analysis.md`, query GHL and compare contact counts within ±2%.
2. Confirm `needs_reengagement` tag is applied correctly (compare count against `reengagement_candidates.csv`).
3. Confirm 100% of `email_opt_out=true` contacts have `dnd=true` in GHL (hard constraint — any miss is a P0 compliance bug).

### Task 5.4: Data Agent — round-trip schema check

**Agent Role:** Data
**Steps:**
1. Re-pull 10 random migrated contacts via `mcp__ghl__get_contact`.
2. For each, verify custom fields `zoho_id`, `zoho_created_at`, `zoho_updated_at`, `zoho_owner` match source exactly.
3. Any drift → write to `05-reports/schema_drift.csv`.

All four verification outputs are consolidated into `verification_report.md`. If any P0 fails (opt-out honoring, duplicate creation, row-count delta > 5%) → invoke Rollback.

---

## 11. Rollback Plan

### Trigger conditions (any one fires rollback)
- Opt-out compliance failure (Task 5.3 step 3)
- Duplicate contacts detected (Task 5.1 step 4) for > 1% of imports
- Row count delta > 5% that cannot be explained by drop/dedup reports
- Human request ("rollback") within 72 hours of go-live

### Rollback procedure
1. **Freeze writes.** Disable the migration orchestrator. Do not run any Phase 4 tasks.
2. **Identify scope.** Every migrated contact has tag `zoho_migrated_2026_04`. Query:
   ```python
   client = GHLClient()
   page = None
   migrated = []
   while True:
       resp = client.search_contacts(query="zoho_migrated_2026_04", limit=100, start_after_id=page)
       migrated.extend(resp["contacts"])
       if not resp.get("meta", {}).get("startAfterId"): break
       page = resp["meta"]["startAfterId"]
   ```
3. **Classify each migrated contact:**
   - **Only exists because of migration** (no activity since import, no `source:live_webhook` tag) → soft-delete via `mcp__ghl__delete_contact`.
   - **Pre-existed in GHL and we upserted onto it** → revert custom fields to prior state using backup snapshot (see below) AND remove tags `zoho_migrated_2026_04`, `source:zoho_spa`.
4. **Backup snapshot (must exist BEFORE Phase 4):** Immediately before Task 4.1 starts, the importer MUST pull a full contacts dump via `search_contacts` with no filter → store as `.tmp/migration/pre_import_snapshot.json`. This is the rollback source of truth.
5. **Opportunities:** Delete any opportunity where custom field `zoho_deal_id` is non-null — these are migration-only.
6. **Notes/Tasks:** Delete notes/tasks whose body starts with the Zoho-provenance prefix (we will add `[zoho-migrated]` prefix during import for this purpose).
7. **Communicate:** Post rollback report to Slack + email team; pause any GHL automations that fired from migrated tags (e.g., welcome workflows should be paused via `mcp__ghl__ghl_get_workflows` + human toggle).

### Partial rollback
If rollback scope is limited (e.g., only one pipeline stage is bad), re-run Phase 3 for that subset only and re-import via upsert — no full wipe needed.

---

## 12. Post-Migration Checklist (human must sign off)

- [ ] `verification_report.md` shows zero P0 failures
- [ ] Spot-check 10 random migrated contacts in GHL UI — everything looks right
- [ ] Top 5 high-value active opportunities visible in the setter queue
- [ ] `task_engine.py` dry-run against migrated contacts — no spurious tasks created
- [ ] Klaviyo sync (`Config/email-strategy/spa`) re-runs and picks up `needs_reengagement` segment
- [ ] Meta CAPI events for migrated contacts can now fire (their emails hash correctly)
- [ ] Update `CRM-SPA/CLAUDE.md` with a new learning rule:
      `ALWAYS check for zoho_migrated_2026_04 tag before assuming a contact's history — because historical events predate GHL. Example: setter sees "no prior contact" but contact has 3 pre-migration notes; check notes tab first.`
- [ ] Archive `.tmp/migration/` to cloud storage: `gdrive:backups/zoho_to_ghl_spa_2026_04_21/`
- [ ] Purge `.tmp/migration/` locally after 30 days
- [ ] Decommission Zoho Spa ingestion: freeze writes (read-only), keep org for audit for 12 months
- [ ] Update `09-Miscellaneous/learnings/LEARNINGS.md` with lessons from this run

---

## 13. Orchestrator — `run_migration.py`

**Agent Role:** CRM (coordinator)
**File:** `Tools/migration/run_migration.py`
**Contract:** Runs phases 1→5 in order. Halts at the approval gate between Phase 3 and Phase 4. Idempotent — safe to re-run.

```python
"""
Zoho → GHL Spa migration orchestrator.

Usage:
  python Tools/migration/run_migration.py --phase all
  python Tools/migration/run_migration.py --phase 1
  python Tools/migration/run_migration.py --phase 4 --confirm
  python Tools/migration/run_migration.py --verify-only
  python Tools/migration/run_migration.py --rollback
"""

import argparse, json, sys
from pathlib import Path

ROOT = Path(".tmp/migration")
APPROVAL = ROOT / "04-ready" / "APPROVAL.txt"

def phase1_extract():
    from .zoho_extractor import run as extract
    extract()

def phase2_analyze():
    from .pipeline_analyzer import run as pipelines
    from .tag_segment_analyzer import run as tags
    # Independent — can run in parallel threads, but sequential is simpler and fast enough.
    pipelines()
    tags()

def phase3_clean_map():
    from .data_cleaner import run as clean
    from .field_mapper  import run as mapf
    clean()
    mapf()
    print("[HALT] Phase 3 complete. Review .tmp/migration/04-ready/ then edit APPROVAL.txt to proceed.")

def phase4_import():
    if not APPROVAL.exists() or not APPROVAL.read_text().startswith("APPROVED"):
        sys.exit("Approval gate not cleared. Edit 04-ready/APPROVAL.txt first.")
    from .ghl_importer import run as importer
    importer()

def phase5_verify():
    from .migration_verifier import run as verifier
    verifier()

def rollback():
    from .ghl_importer import rollback as rb
    rb()

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["1","2","3","4","5","all"], default="all")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--rollback", action="store_true")
    args = ap.parse_args()

    if args.rollback: rollback(); sys.exit(0)
    if args.verify_only: phase5_verify(); sys.exit(0)

    phases = {"1": phase1_extract, "2": phase2_analyze, "3": phase3_clean_map,
              "4": phase4_import,   "5": phase5_verify}
    if args.phase == "all":
        phase1_extract(); phase2_analyze(); phase3_clean_map()
        print("Stopping before Phase 4. Re-run with --phase 4 after approval.")
    else:
        phases[args.phase]()
```

---

## 14. Developer Quickstart

New developer with no context runs this top-to-bottom:

```bash
# 0. Prereqs
cd "/Users/mertgulen/Library/CloudStorage/GoogleDrive-mertgulen98@gmail.com/My Drive/Carisma Wellness Group/Carisma AI /Carisma AI"
pip install -r CRM/ghl/requirements.txt
pip install phonenumbers email-validator tqdm

# 1. Confirm credentials
python -c "from CRM.ghl.client import GHLClient; print(GHLClient().get_pipelines()[:1])"

# 2. Phase 1-3 (extract, analyze, clean, map). Safe to run; no writes to GHL.
python Tools/migration/run_migration.py --phase 1
python Tools/migration/run_migration.py --phase 2
python Tools/migration/run_migration.py --phase 3

# 3. Human review
open .tmp/migration/04-ready/MIGRATION_SUMMARY.md
# Spot-check 10 random records in .tmp/migration/04-ready/contacts_import.json
# If happy, approve:
echo "APPROVED 2026-04-21 MG" > .tmp/migration/04-ready/APPROVAL.txt

# 4. Phase 4 — writes to GHL
python Tools/migration/run_migration.py --phase 4

# 5. Verification
python Tools/migration/run_migration.py --phase 5
open .tmp/migration/05-reports/verification_report.md

# 6. If anything is wrong
python Tools/migration/run_migration.py --rollback
```

---

## 15. Open Questions for the Human (answer before kickoff)

1. **Internal staff domain** — what email domains are staff-only so Rule 4 of §4.3 can drop them?
2. **Owner → GHL user map** — do we need to map Zoho owner names to GHL users, or is `zoho_owner` as free text fine?
3. **Currency** — are all Zoho `Amount` values already in EUR? If any are GBP/USD, we need an FX conversion step.
4. **Closed-Lost deals** — do we import them at all? They clutter GHL search. Recommend: import but with tag `archived_zoho_lost`, not visible in default pipeline views.
5. **Leads vs Contacts** — Zoho has separate Lead and Contact modules. In GHL everything is a Contact. Confirm: unconverted Leads should also be imported (treated same as Contacts + tag `was_unconverted_lead`).
6. **Timezone** — all timestamps Europe/Malta? Any UTC-stored that need offset fix?
7. **Consent replay** — EU/GDPR: we're porting marketing opt-in from Zoho. Confirm the Zoho opt-in evidence is sufficient for GHL/Klaviyo use. (Legal review likely needed.)

---

**End of plan.**
