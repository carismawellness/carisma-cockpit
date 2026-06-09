"""
Direct REST extractor for Zoho CRM v7 — bypasses MCP for full extraction runs.

Reads brand-specific OAuth credentials from .env:
    ZOHO_SPA_CLIENT_ID  / ZOHO_SPA_CLIENT_SECRET  / ZOHO_SPA_REFRESH_TOKEN
    ZOHO_AES_CLIENT_ID  / ZOHO_AES_CLIENT_SECRET  / ZOHO_AES_REFRESH_TOKEN
    ZOHO_SLIM_CLIENT_ID / ZOHO_SLIM_CLIENT_SECRET / ZOHO_SLIM_REFRESH_TOKEN

Writes:
    .tmp/migration/{brand}/01-raw/org.json
    .tmp/migration/{brand}/01-raw/users.json
    .tmp/migration/{brand}/01-raw/tags.json
    .tmp/migration/{brand}/01-raw/{contacts,leads,deals,notes,tasks}.json
    .tmp/migration/{brand}/01-raw/schema/{module}_fields.json
    .tmp/migration/{brand}/01-raw/schema/pipelines.json
    .tmp/migration/{brand}/01-raw/EXTRACTION_REPORT.md

Usage:
    python -m Tools.migration.zoho_rest_extractor --brand aesthetics
    python -m Tools.migration.zoho_rest_extractor --brand slimming
"""
import argparse
import json
import os
import time
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"
load_dotenv(BASE / ".env")

API_DOMAIN = "https://www.zohoapis.eu"
ACCOUNTS_URL = "https://accounts.zoho.eu/oauth/v2/token"

BRAND_ENV = {
    "spa": "SPA",
    "aesthetics": "AES",
    "slimming": "SLIM",
}

MODULES = ["Contacts", "Leads", "Deals", "Notes", "Tasks"]

# Zoho v7 API caps `fields=` at 50 entries. We use a curated whitelist per module
# (intersected at runtime with actually-existing fields per brand). Order matters
# only for prioritization if we ever need to truncate.
ESSENTIAL_FIELDS = {
    "Contacts": [
        "id", "First_Name", "Last_Name", "Full_Name", "Salutation",
        "Email", "Secondary_Email", "Phone", "Mobile", "Home_Phone",
        "Mailing_Street", "Mailing_City", "Mailing_State", "Mailing_Country", "Mailing_Zip",
        "Lead_Source", "Tag", "Owner", "Description", "Date_of_Birth",
        "Created_Time", "Modified_Time", "Last_Activity_Time",
        "Email_Opt_Out", "Do_Not_Call", "Unsubscribed_Mode", "Unsubscribed_Time",
        "Account_Name", "Lifecycle_Stage", "Last_Treatment_Date", "Treatment_Count",
        "No_of_Bookings", "Booking_Won", "Brand",
        "Ad_Campaign", "Ad_Set", "Ad_Account", "Lead_Form", "Lead_Type",
        "FB_Form_Name", "WhatsApp_Opt_Out", "Bulk_WhatsApp",
        "Interested_Treatment", "Consultation_Date", "Subscription_Date",
        "GCLID", "Where_did_you_hear_about_us",
    ],
    "Leads": [
        "id", "First_Name", "Last_Name", "Full_Name", "Salutation",
        "Email", "Secondary_Email", "Phone", "Mobile",
        "Street", "City", "State", "Country", "Zip_Code", "Company",
        "Lead_Source", "Lead_Status", "Tag", "Owner", "Description",
        "Created_Time", "Modified_Time", "Last_Activity_Time",
        "Email_Opt_Out", "Do_Not_Call", "Unsubscribed_Mode", "Unsubscribed_Time",
        "Brand", "Ad_Campaign", "Ad_Set", "Ad_Account", "Lead_Form", "Lead_Type",
        "FB_Form_Name", "WhatsApp_Opt_Out", "Lifecycle_Stage",
        "Interested_Treatment", "GCLID",
        "Where_did_you_hear_about_us",
    ],
    "Deals": [
        "id", "Deal_Name", "Stage", "Amount", "Closing_Date", "Pipeline",
        "Contact_Name", "Account_Name", "Lead_Source", "Owner", "Description", "Tag",
        "Created_Time", "Modified_Time", "Last_Activity_Time",
        "Probability", "Type", "Expected_Revenue",
    ],
    "Notes": [
        "id", "Note_Title", "Note_Content", "Parent_Id", "$se_module",
        "Owner", "Created_Time", "Modified_Time",
    ],
    "Tasks": [
        "id", "Subject", "Description", "Status", "Due_Date", "Priority",
        "Closed_Time", "What_Id", "Who_Id", "$se_module",
        "Owner", "Created_Time", "Modified_Time",
    ],
}

ZOHO_FIELDS_CAP = 50


class ZohoREST:
    def __init__(self, brand: str):
        env = BRAND_ENV[brand]
        try:
            self.cid = os.environ[f"ZOHO_{env}_CLIENT_ID"]
            self.secret = os.environ[f"ZOHO_{env}_CLIENT_SECRET"]
            self.refresh_token = os.environ[f"ZOHO_{env}_REFRESH_TOKEN"]
        except KeyError as e:
            raise RuntimeError(f"Missing env var: {e}") from e
        self.access_token: Optional[str] = None
        self.expiry: float = 0.0
        self.http = httpx.Client(timeout=60)

    def _refresh(self) -> None:
        r = self.http.post(ACCOUNTS_URL, data={
            "grant_type": "refresh_token",
            "client_id": self.cid,
            "client_secret": self.secret,
            "refresh_token": self.refresh_token,
        })
        d = r.json()
        if "access_token" not in d:
            raise RuntimeError(f"Token refresh failed: {d}")
        self.access_token = d["access_token"]
        self.expiry = time.time() + d.get("expires_in", 3600) - 300

    def _headers(self) -> dict:
        if not self.access_token or time.time() >= self.expiry:
            self._refresh()
        return {"Authorization": f"Zoho-oauthtoken {self.access_token}"}

    def get(self, path: str, params: Optional[dict] = None) -> dict:
        url = f"{API_DOMAIN}/crm/v7{path}"
        for attempt in range(3):
            try:
                r = self.http.get(url, headers=self._headers(), params=params)
                if r.status_code == 401:
                    self._refresh()
                    r = self.http.get(url, headers=self._headers(), params=params)
                if r.status_code == 204:
                    return {"data": [], "info": {"more_records": False}}
                if r.status_code == 429:
                    time.sleep(5 * (attempt + 1))
                    continue
                r.raise_for_status()
                return r.json()
            except httpx.HTTPError as e:
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"Failed after 3 attempts: GET {path}")

    def field_names(self, module: str) -> set:
        """Return the set of readable field api_names for a module."""
        resp = self.get("/settings/fields", params={"module": module})
        out = set()
        for f in resp.get("fields", []):
            api_name = f.get("api_name")
            if not api_name or f.get("data_type") == "subform":
                continue
            out.add(api_name)
        return out

    def select_fields(self, module: str) -> str:
        """Curated essentials ∩ existing schema, capped at 50 (Zoho v7 limit)."""
        existing = self.field_names(module)
        wanted = ESSENTIAL_FIELDS.get(module, [])
        # Preserve whitelist order (so 'id', 'First_Name' etc are always in)
        chosen = [f for f in wanted if f in existing]
        if len(chosen) > ZOHO_FIELDS_CAP:
            print(f"  [{module}] WARN: {len(chosen)} matched essentials, truncating to {ZOHO_FIELDS_CAP}", flush=True)
            chosen = chosen[:ZOHO_FIELDS_CAP]
        print(f"  [{module}] using {len(chosen)} fields: {','.join(chosen[:8])}{' …' if len(chosen)>8 else ''}", flush=True)
        return ",".join(chosen)

    def list_all(self, module: str, per_page: int = 200, fields: Optional[str] = None) -> list:
        if fields is None:
            fields = self.select_fields(module)
        all_records: list = []
        page = 1
        page_token: Optional[str] = None
        while True:
            params: dict = {"per_page": per_page, "fields": fields}
            if page_token:
                params["page_token"] = page_token
            else:
                params["page"] = page
            try:
                resp = self.get(f"/{module}", params=params)
            except httpx.HTTPStatusError as e:
                # Some modules (Notes, Tasks) may 400 on certain orgs
                print(f"  [{module}] page {page}: HTTP error {e.response.status_code}: {e.response.text[:200]}", flush=True)
                break
            data = resp.get("data", [])
            all_records.extend(data)
            info = resp.get("info", {})
            print(f"  [{module}] page {page} (token={page_token[:8]+'...' if page_token else 'none'}): "
                  f"+{len(data)} records (total {len(all_records)})", flush=True)
            if not info.get("more_records") or len(data) == 0:
                break
            if "next_page_token" in info:
                page_token = info["next_page_token"]
            else:
                page += 1
                page_token = None
            time.sleep(0.4)
        return all_records


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))


def extract_brand(brand: str) -> dict:
    out = TMP / brand / "01-raw"
    schema_dir = out / "schema"
    schema_dir.mkdir(parents=True, exist_ok=True)

    z = ZohoREST(brand)
    started = time.strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n=== Extracting {brand.upper()} ({started}) ===\n", flush=True)

    report = [f"# Extraction Report — {brand}", f"Started: {started}", ""]
    counts: dict = {}

    # Org
    print("→ org", flush=True)
    try:
        org = z.get("/org")
        write_json(out / "org.json", org)
        org_name = (org.get("org") or [{}])[0].get("company_name", "?")
        report.append(f"- org: {org_name}")
        print(f"   org: {org_name}", flush=True)
    except Exception as e:
        report.append(f"- org: ERROR {e}")

    # Users
    print("→ users", flush=True)
    try:
        users = z.get("/users", params={"type": "AllUsers"}).get("users", [])
        write_json(out / "users.json", users)
        counts["users"] = len(users)
        report.append(f"- users: {len(users)}")
    except Exception as e:
        report.append(f"- users: ERROR {e}")

    # Pipelines (via Deals layouts → blueprint can yield stage info, but the
    # simplest is /settings/pipeline?layout_id=… — we just save layouts and
    # let downstream tools look up Stage_History from records themselves)
    print("→ pipelines (via layouts)", flush=True)
    try:
        layouts = z.get("/settings/layouts", params={"module": "Deals"})
        write_json(schema_dir / "pipelines.json", layouts)
    except Exception as e:
        report.append(f"- pipelines layouts: ERROR {e}")

    # Tags
    print("→ tags", flush=True)
    try:
        tags = z.get("/settings/tags", params={"module": "Contacts"}).get("tags", [])
        write_json(out / "tags.json", tags)
        counts["tags"] = len(tags)
        report.append(f"- tags: {len(tags)}")
    except Exception as e:
        write_json(out / "tags.json", [])
        report.append(f"- tags: ERROR {e}")

    # Field schemas
    for module in MODULES:
        print(f"→ schema/{module}", flush=True)
        try:
            fields = z.get("/settings/fields", params={"module": module})
            write_json(schema_dir / f"{module}_fields.json", fields)
        except Exception as e:
            report.append(f"- {module} fields: ERROR {e}")

    # Records
    for module in MODULES:
        print(f"→ records/{module}", flush=True)
        try:
            records = z.list_all(module)
            write_json(out / f"{module.lower()}.json", records)
            counts[module.lower()] = len(records)
            report.append(f"- {module}: {len(records)}")
        except Exception as e:
            counts[module.lower()] = -1
            report.append(f"- {module}: ERROR {e}")

    finished = time.strftime("%Y-%m-%d %H:%M:%S")
    report.append("")
    report.append(f"Finished: {finished}")
    (out / "EXTRACTION_REPORT.md").write_text("\n".join(report))

    print(f"\n=== Done {brand.upper()} ===\n{json.dumps(counts, indent=2)}", flush=True)
    return counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand", required=True, choices=list(BRAND_ENV.keys()))
    args = ap.parse_args()
    extract_brand(args.brand)


if __name__ == "__main__":
    main()
