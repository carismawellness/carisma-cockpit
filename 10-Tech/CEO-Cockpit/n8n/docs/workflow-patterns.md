# n8n Workflow Patterns & Best Practices

## Five Architectural Patterns

### 1. Webhook-Triggered
External service POSTs data → n8n processes immediately.
```
Webhook → Transform → Route → Action → Respond to Webhook
```
**Use when:** Real-time processing needed (form submissions, lead capture, payment notifications)

### 2. Scheduled / Cron
Time-based execution using Schedule Trigger.
```
Schedule Trigger → Fetch Data → Transform → Store/Report
```
**Use when:** Periodic tasks (daily reports, hourly syncs, weekly digests)

### 3. Event-Driven Polling
Periodically check external systems for new data.
```
Schedule Trigger → HTTP Request (check for changes) → If (new data?) → Process
```
**Use when:** Source system doesn't support webhooks

### 4. Sub-Workflow Orchestration
Parent workflow calls child workflows for modular logic.
```
Main Trigger → Execute Sub-workflow A → Execute Sub-workflow B → Merge Results
```
**Use when:** Workflows exceed 15-20 nodes or share common logic

### 5. Error-Handling Pipeline
Separate workflow catches failures from other workflows.
```
Error Trigger → Extract Error Details → Log to Sheet → Send Alert → Create Ticket
```
**Use when:** Always. Every production workflow needs error handling.

## Common Flow Patterns

### Conditional Routing
```
Trigger → If/Switch → Branch A (hot leads) / Branch B (cold leads) / Branch C (spam)
```

### Batch Processing
```
Trigger → Get All Items → Loop Over Items → Process Each → Aggregate Results
```

### Human-in-the-Loop
```
Trigger → AI Process → Wait (for approval webhook) → If Approved → Execute Action
```

### Fan-Out / Fan-In
```
Trigger → Split into items → Process each in parallel → Merge results → Final action
```

### Retry with Backoff
Enable "Retry on Fail" on individual nodes:
- Max attempts: 3-5
- Wait between retries: exponential (1s, 2s, 4s)
- HTTP 5xx → retry
- HTTP 401 → refresh credentials
- HTTP 422 → manual review

## Best Practices

### Workflow Organization
- **One workflow, one job** — each workflow does exactly one describable task
- **Naming:** `[env]-[domain]-[action]-[integration]-[version]`
  - `prod-sales-lead-sync-zoho-v1`
  - `dev-marketing-report-meta-v2`
- Rename ALL nodes descriptively: "Get Lead from Zoho" not "HTTP Request1"
- Add Sticky Note nodes explaining complex logic sections
- Group related nodes visually

### Error Handling Checklist
- [ ] Error Trigger workflow wired to every critical workflow
- [ ] Captures: workflow name, failed node, input data, error message, execution URL
- [ ] Retry-on-fail enabled for API calls
- [ ] Dead letter queue for permanently failed items
- [ ] Alert channel configured (Slack/email/Trello)

### Webhook Security
- [ ] Authentication required (header token, basic auth, or HMAC)
- [ ] Webhook URLs treated as secrets
- [ ] Rate limiting at reverse proxy level
- [ ] Paths are case-sensitive — document exact paths
- [ ] Test vs Production URLs understood

### Webhook Response Modes
1. **Immediately** — Returns 200 before processing (fire-and-forget)
2. **When Last Node Finishes** — Returns output of last node (synchronous)
3. **Using Respond to Webhook Node** — Full control over response body/headers/status

### Data Flow
- All data between nodes is `[{ "json": { ... }, "binary": {} }]`
- Code node auto-wraps with `json` key since v0.166.0
- `$json` refers to current item only
- Use `$input.all()` for all items
- Merge node modes: Append, Combine (by position/field), Keep matches only

### Testing
- Test with real-world payloads, not clean dummy data
- Test failure paths: malformed input, expired creds, API timeouts, empty results
- Pin test data on nodes during development
- Inspect exported JSON for embedded secrets before sharing
- Never edit production workflows directly — clone → test → deploy
