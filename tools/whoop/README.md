# Tools/whoop

Personal WHOOP data pull + stress analysis. WHOOP v2 API.

## Files
- `client.py` — `WhoopClient` with OAuth 2.0 auto-refresh + v2 endpoints
- `auth_setup.py` — one-time interactive OAuth flow (localhost callback)
- `pull.py` — pulls last N days into CSVs
- `analyze.py` — trend analysis (HRV, RHR, recovery, sleep)

## Setup
1. Register app at https://developer.whoop.com (redirect URI: `http://localhost:8080/callback`)
2. Add `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` to `.env`
3. `python Tools/whoop/auth_setup.py`

## Use
```bash
python Tools/whoop/pull.py --days 90
python Tools/whoop/analyze.py
```

See [`09-Miscellaneous/Workflows/whoop_pull.md`](../../09-Miscellaneous/Workflows/whoop_pull.md) for full workflow.
