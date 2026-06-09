# Workflow: WHOOP Data Pull & Stress Analysis

**Owner:** Mert (personal health data)
**Tools:** `Tools/whoop/` package
**API:** WHOOP v2 (developer.whoop.com)

## Objective
Pull personal WHOOP data (recovery, cycles, sleep, workouts) over a configurable window, write flat CSVs, and surface chronic-stress markers (HRV trend, RHR trend, recovery trend, sleep architecture).

## Required Inputs
- `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` in `.env` (from a registered app at developer.whoop.com)
- Refresh token cached at `.tmp/whoop_tokens.json` (created by one-time `auth_setup.py`)

## One-Time Setup (≈ 5 min)

1. **Register dev app** at https://developer.whoop.com → Create App
   - Redirect URI **must be exactly:** `http://localhost:8080/callback`
   - Scopes: `read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement offline`
2. Paste `Client ID` and `Client Secret` into `.env`
3. Run OAuth flow:
   ```bash
   python Tools/whoop/auth_setup.py
   ```
   - Browser opens → authorize → tokens saved to `.tmp/whoop_tokens.json`
4. Verify with profile call:
   ```bash
   python -c "from Tools.whoop.client import WhoopClient; print(WhoopClient().get_profile())"
   ```

## Routine Use

### Pull data
```bash
python Tools/whoop/pull.py --days 90        # CSVs only
python Tools/whoop/pull.py --days 30 --json # CSVs + raw JSON
```
Output: `.tmp/whoop_data/{cycles,recovery,sleep,workouts}.csv`

### Analyze
```bash
python Tools/whoop/analyze.py               # full window
python Tools/whoop/analyze.py --window 30   # last 30 days only
```
Surfaces:
- HRV mean / median / linear trend
- RHR mean / median / linear trend
- Recovery score trend
- Sleep performance, efficiency, REM/deep duration
- Disturbance count
- Day strain
- Chronic-stress flag if HRV ↓ AND RHR ↑ together

## Edge Cases / Gotchas

- WHOOP API `limit` is capped at **25** per request — `_paginate()` handles this with `nextToken`.
- Refresh tokens **rotate** per use. The client persists the new refresh token automatically.
- If `.tmp/` is wiped, just re-run `auth_setup.py` — no need to re-register the app.
- Date range must be ISO-8601 with `Z` suffix; `pull.py` formats this for you.
- WHOOP's "stress" score is derived; the raw HRV (`score.hrv_rmssd_milli`) is the truth. Use HRV trend, not stress score, for chronic-load reads.

## Expected Outputs
- `.tmp/whoop_data/cycles.csv` — daily strain, HR stats, calories
- `.tmp/whoop_data/recovery.csv` — HRV, RHR, recovery score, SpO2, skin temp
- `.tmp/whoop_data/sleep.csv` — performance, efficiency, stage durations, disturbances
- `.tmp/whoop_data/workouts.csv` — per-session strain, HR zones, sport
- `analyze.py` stdout — trend report

## Active Rules
_None yet._
