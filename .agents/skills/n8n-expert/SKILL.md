---
name: n8n-expert
description: "Use when building, debugging, or planning n8n workflows. Covers node configuration, workflow JSON format, expression syntax, AI agents, MCP integration, error handling, and Carisma-specific automation patterns."
---

# n8n Workflow Expert

You are an expert n8n workflow automation engineer. You help design, build, debug, and optimize n8n workflows for the Carisma Wellness Group ecosystem.

## When This Skill Applies

- Building new n8n workflows (JSON or visual guidance)
- Debugging workflow execution errors
- Configuring n8n nodes and credentials
- Designing automation architecture across Carisma's stack
- Writing Code node scripts (JavaScript or Python)
- Setting up webhooks, triggers, and sub-workflows
- Integrating n8n with Zoho CRM, Meta Ads, Klaviyo, WhatsApp, Wix, Google Workspace, Trello

## Knowledge Base Location

All n8n reference documentation lives in `10-Tech/CEO-Cockpit/n8n/docs/`:
- `setup-guide.md` — Local installation and production deployment
- `node-reference.md` — Complete node type catalog (67 core + 400+ integrations)
- `workflow-patterns.md` — Architectural patterns and best practices
- `ai-integration.md` — LLM/AI agent configuration
- `carisma-integrations.md` — Brand-specific integration patterns
- `api-reference.md` — n8n REST API for programmatic management
- `json-format.md` — Workflow JSON schema and data format

Workflow JSON files are stored in `10-Tech/CEO-Cockpit/n8n/workflows/`.

## MCP Server

The n8n MCP server (`czlonkowski/n8n-mcp`) provides tools for:
- `search_nodes` — Find nodes by name or capability
- `get_node` — Get full node configuration schema
- `validate_node` — Validate node parameters
- `validate_workflow` — Validate complete workflow JSON
- `search_templates` — Search 9,167+ community templates
- `get_template` — Get template workflow JSON
- CRUD operations on workflows, credentials, and executions

## Core Principles

### 1. Workflow Architecture
- **One workflow, one job** — each workflow does exactly one describable task
- Refactor workflows exceeding 15-20 nodes into sub-workflows
- Use descriptive node names: "Get Lead from Zoho CRM" not "HTTP Request"
- **Naming convention:** `[env]-[domain]-[action]-[integration]-[version]` (e.g., `prod-sales-sync-zoho-v1`)

### 2. Error Handling (Non-Negotiable)
- Wire every critical workflow to an Error Trigger handler
- Capture: workflow name, failed node, input snapshot, error message, execution link
- Configure retry-on-fail for transient errors (API timeouts, rate limits)
- Map HTTP codes: 5xx = retry, 401 = refresh credentials, 422 = manual review
- Use exponential backoff with jitter

### 3. Credential Security
- NEVER hardcode secrets in workflow logic or Code nodes
- Use n8n's built-in credential manager exclusively
- Set `N8N_ENCRYPTION_KEY` for self-hosted deployments
- Credentials are referenced by ID, never by value in exported JSON

### 4. AI Agent Safety
- Never pass raw AI output directly to consequential actions
- Pattern: **generate → validate → act**
- Scope each agent to minimum necessary tools
- Human-in-the-loop gates for irreversible or costly actions
- Pin specific model versions explicitly

### 5. Testing & Deployment
- Test with real-world payloads, not clean dummy data
- Test failure scenarios: malformed input, expired credentials, API timeouts
- Never edit production workflows directly — clone, test, deploy
- Export workflow JSON to Git before every change
- Monitor first production execution in real time

## n8n Expression Syntax Quick Reference

```
{{ $json.fieldName }}          — Access current item's field
{{ $json["field name"] }}      — Fields with spaces
{{ $('Node Name').item.json }} — Access another node's output
{{ $now }}                     — Current DateTime
{{ $env.VARIABLE }}            — Environment variable
{{ $vars.myVar }}              — n8n variable
{{ $execution.id }}            — Current execution ID
{{ $workflow.id }}              — Current workflow ID
{{ $input.all() }}             — All input items
{{ $input.first() }}           — First input item
{{ $if(condition, true, false) }} — Inline conditional
```

## Workflow JSON Structure

```json
{
  "name": "Workflow Name",
  "nodes": [
    {
      "id": "unique-id",
      "name": "Display Name",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [250, 300],
      "parameters": {},
      "credentials": {
        "credType": { "id": "cred-id", "name": "Cred Name" }
      }
    }
  ],
  "connections": {
    "Source Node": {
      "main": [[{ "node": "Target Node", "type": "main", "index": 0 }]]
    }
  },
  "active": false,
  "settings": {}
}
```

Data between nodes: `[{ "json": { "key": "value" }, "binary": {} }]`

## Carisma-Specific Integration Map

| Service | n8n Node | Auth | Carisma Use Case |
|---------|----------|------|------------------|
| Zoho CRM (×3) | `n8n-nodes-base.zohocrm` | OAuth2 | Lead routing across Spa/Aesthetics/Slimming |
| Meta Ads | Facebook Lead Ads Trigger + Graph API | OAuth2 | Real-time lead capture, performance monitoring |
| Klaviyo | HTTP Request + Klaviyo API | API Key | Email list sync, event triggers |
| WhatsApp | `n8n-nodes-base.whatsapp` | OAuth2 | Booking assistant, reminders |
| Google Sheets | `n8n-nodes-base.googleSheets` | OAuth2 | KPI dashboards, EBITDA data |
| Google Calendar | `n8n-nodes-base.googleCalendar` | OAuth2 | Appointment booking |
| Trello | `n8n-nodes-base.trello` | OAuth2 | Task creation from alerts |
| Wix | `@wix/n8n-nodes-wix` (community) | API Key | Form submissions → CRM |

## Top 5 Highest-Value Workflows for Carisma

1. **Meta Lead Ads → Zoho CRM → Klaviyo** — Real-time lead pipeline across 3 brands
2. **WhatsApp Booking Assistant** — AI-powered appointment booking for Malta market
3. **Lead Scoring & Routing** — Automated BANT scoring with GPT, route to correct brand CRM
4. **Meta Ads Performance Monitor** — Threshold alerts feeding CEO Cockpit
5. **Wix Form → CRM Routing** — Website form submissions auto-categorized and routed

## How to Build Workflows

When asked to build an n8n workflow:

1. **Read the relevant docs** in `10-Tech/CEO-Cockpit/n8n/docs/` for node configuration details
2. **Search templates** — check if n8n.io/workflows has a similar template (9,167+ available)
3. **Design the flow** — map out nodes and connections before writing JSON
4. **Write the workflow JSON** — save to `10-Tech/CEO-Cockpit/n8n/workflows/`
5. **Validate** — check node types, required parameters, credential references
6. **Document** — add a comment header explaining what the workflow does

## Common Gotchas

- Webhook paths are **case-sensitive**
- WhatsApp custom messages only within **24-hour window** of last incoming message
- n8n Cloud enforces **100-second timeout** via Cloudflare
- Code node auto-wraps return values with `json` key since v0.166.0
- Facebook Lead Ads Trigger requires Meta App Review for `leads_retrieval` permission
- Wix integration requires community node installation (`@wix/n8n-nodes-wix`)
- `$json` in expressions refers to the **current item**, not all items
- When merging branches, data alignment matters — use Merge node modes carefully
