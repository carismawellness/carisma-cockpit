# Push CAPI Conversions

## Objective

Sync Zoho CRM deal stage changes back to Meta via the Conversions API (CAPI), enabling "Appointments Made" and "Consultations Booked" as native columns in Meta Ads Manager for closed-loop attribution.

## Required Inputs

| Input | Source | Description |
|-------|--------|-------------|
| `Config/brands.json` | Manual config | Brand definitions with pixel IDs and CAPI event config |
| `.env` | Environment | `META_ACCESS_TOKEN`, Zoho OAuth creds per brand |

### Brand-Specific Stage Mapping

| Brand | ConsultationBooked Trigger | AppointmentMade Trigger |
|-------|---------------------------|------------------------|
| Carisma Spa | Closed Won | Closed Won |
| Carisma Aesthetics | Consultation - won | Booking closed won |
| Carisma Slimming | Consultation - won | Booking closed won |

## Tools Used

| Tool | Purpose |
|------|---------|
| `Tools/push_capi_conversions.py` | Query Zoho CRM, build CAPI events, send to Meta, mark deals |

## Step-by-Step Procedure

### Step 1: Run the Sync (All Brands)

```bash
python3 Tools/push_capi_conversions.py --all-brands
```

Or for a specific brand:
```bash
python3 Tools/push_capi_conversions.py --brand carisma_aesthetics
```

To preview without sending:
```bash
python3 Tools/push_capi_conversions.py --all-brands --dry-run
```

### Step 2: Verify in Meta Events Manager

1. Go to Events Manager for each ad account
2. Check that `ConsultationBooked` and `AppointmentMade` events appear
3. Verify Event Match Quality score > 6.0

### Step 3: Check Ads Manager Columns

1. In Ads Manager, click Columns > Customize Columns
2. Search for `AppointmentMade` and `ConsultationBooked`
3. Add them to your reporting view
4. Save as preset "Carisma Full Funnel"

## Automation

Runs every 4 hours via macOS launchd:
- Plist: `~/Library/LaunchAgents/com.carisma.capi-sync.plist`
- Logs: `/tmp/capi-sync.log` and `/tmp/capi-sync-error.log`

### Manual commands:
```bash
# Check if the job is running
launchctl list | grep capi

# Unload/reload
launchctl unload ~/Library/LaunchAgents/com.carisma.capi-sync.plist
launchctl load ~/Library/LaunchAgents/com.carisma.capi-sync.plist
```

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| Token expired | Meta access token expires every 60 days | Renew at Business Settings > System Users |
| Zoho auth failed | Refresh token revoked | Re-generate OAuth credentials in Zoho API console |
| CAPI 400 error | Invalid payload or pixel ID | Check `--dry-run` output, verify pixel IDs in brands.json |
| Low Event Match Quality | Missing PII or Lead ID | Check that Meta_Lead_ID is populated for Facebook Lead Ads leads |

## Maintenance

- **Every 60 days:** Renew Meta access token and update `.env`
- **After CRM changes:** If Zoho deal stages are renamed, update `capi_events` in `Config/brands.json`
- **Monitoring:** Check `/tmp/capi-sync.log` periodically for errors

## Prerequisites (One-Time Setup)

See the implementation plan at `10-Tech/Docs/plans/2026-04-17-capi-appointments-made.md` for full setup instructions including:
- Meta pixel creation
- Zoho CRM custom field setup (CAPI_Sent, Meta_Lead_ID, etc.)
- Aggregated Event Measurement configuration
- Ads Manager custom column setup
