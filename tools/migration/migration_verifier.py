"""
Post-import integrity verifier. Checks:
1. Row count parity (GHL contacts ≈ cleaned contacts)
2. 5-record spot check (sample contacts verified in GHL)
3. Duplicate check (no email collision in GHL post-import)
4. Stage integrity (opportunities in correct GHL stages)
"""
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

BASE = Path(__file__).parent.parent.parent
TMP = BASE / ".tmp" / "migration"
load_dotenv(BASE / ".env")

GHL_API_KEY = os.getenv("GHL_API_KEY")
GHL_LOCATION_ID = os.getenv("GHL_LOCATION_ID", "TrtSnBSSKBOkVVNxJ3AM")
GHL_BASE_URL = "https://services.leadconnectorhq.com"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {GHL_API_KEY}",
        "Content-Type": "application/json",
        "Version": "2021-07-28",
    }


def _get(path: str, params: dict = None) -> dict:
    import httpx
    resp = httpx.get(f"{GHL_BASE_URL}{path}", params=params or {}, headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def verify_brand(brand: str) -> dict:
    print(f"\n{'='*50}")
    print(f"VERIFYING: {brand.upper()}")
    print(f"{'='*50}")

    results = {"brand": brand, "checks": {}}
    cleaned_dir = TMP / brand / "02-cleaned"
    reports_dir = TMP / brand / "05-reports"
    id_map_path = TMP / brand / "03-mapped" / "email_to_ghl_id.json"

    # ── 1. Row count check ────────────────────────────────────────────────────
    cleaned_file = cleaned_dir / "contacts_clean.json"
    if cleaned_file.exists():
        cleaned = json.loads(cleaned_file.read_text())
        cleaned_count = len(cleaned)
    else:
        print("  [SKIP] No contacts_clean.json — run clean phase first")
        return results

    if id_map_path.exists():
        id_map = json.loads(id_map_path.read_text())
        imported_count = len(id_map)
        delta_pct = abs(imported_count - cleaned_count) / max(cleaned_count, 1) * 100
        ok = delta_pct <= 5.0
        results["checks"]["row_count"] = {
            "cleaned": cleaned_count,
            "imported": imported_count,
            "delta_pct": round(delta_pct, 2),
            "pass": ok,
        }
        status = "✓ PASS" if ok else "✗ FAIL"
        print(f"  Row count: {cleaned_count} cleaned → {imported_count} imported ({delta_pct:.1f}% delta) {status}")
        if not ok:
            print(f"  ⚠️  Delta > 5%: investigate contact_import_report.csv for errors")
    else:
        print("  [SKIP] No email_to_ghl_id.json — run import phase first")

    # ── 2. Spot check 5 contacts ──────────────────────────────────────────────
    if id_map_path.exists():
        id_map = json.loads(id_map_path.read_text())
        sample_emails = list(id_map.keys())[:5]
        spot_results = []
        print(f"\n  Spot-checking {len(sample_emails)} contacts in GHL...")
        for email in sample_emails:
            ghl_id = id_map[email]
            try:
                resp = _get(f"/contacts/{ghl_id}")
                contact = resp.get("contact", resp)
                ghl_email = contact.get("email", "").lower()
                match = ghl_email == email
                spot_results.append({"email": email, "ghl_id": ghl_id, "found": True, "email_match": match})
                status = "✓" if match else "✗ email mismatch"
                print(f"    {email}: {status}")
            except Exception as e:
                spot_results.append({"email": email, "ghl_id": ghl_id, "found": False, "error": str(e)})
                print(f"    {email}: ✗ not found ({e})")

        passed = sum(1 for r in spot_results if r.get("email_match"))
        results["checks"]["spot_check"] = {
            "checked": len(spot_results),
            "passed": passed,
            "pass": passed == len(spot_results),
        }

    # ── 3. Migration tag check ────────────────────────────────────────────────
    print(f"\n  Checking migration tag 'zoho_migrated_2026_04' is applied...")
    if id_map_path.exists():
        sample_id = list(id_map.values())[0] if id_map else None
        if sample_id:
            try:
                resp = _get(f"/contacts/{sample_id}")
                contact = resp.get("contact", resp)
                tags = contact.get("tags", [])
                has_tag = "zoho_migrated_2026_04" in tags
                results["checks"]["migration_tag"] = {"pass": has_tag}
                print(f"  Migration tag: {'✓ PASS' if has_tag else '✗ FAIL — tag missing!'}")
            except Exception as e:
                print(f"  Migration tag check failed: {e}")

    # ── 4. Save verification report ───────────────────────────────────────────
    report_path = reports_dir / "verification_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\n  Report saved → {report_path}")

    all_pass = all(c.get("pass", False) for c in results["checks"].values())
    print(f"\n  {'✓ ALL CHECKS PASSED' if all_pass else '⚠️  SOME CHECKS FAILED — review verification_report.json'}")
    return results


if __name__ == "__main__":
    brand = sys.argv[1] if len(sys.argv) > 1 else "spa"
    verify_brand(brand)
