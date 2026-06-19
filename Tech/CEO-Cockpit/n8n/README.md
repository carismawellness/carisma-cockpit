# n8n Workflow Automation — Carisma Wellness Group

## Quick Start

```bash
# Install n8n
npm install -g n8n

# Start n8n (opens at http://localhost:5678)
n8n start

# Start with webhook tunnel for development
n8n start --tunnel
```

## Directory Structure

```
n8n/
├── docs/                      # Knowledge base
│   ├── setup-guide.md         # Installation & configuration
│   ├── node-reference.md      # Complete node catalog
│   ├── workflow-patterns.md   # Architectural patterns & best practices
│   ├── ai-integration.md      # LLM/AI agent configuration
│   ├── carisma-integrations.md # Brand-specific integration patterns
│   ├── api-reference.md       # n8n REST API
│   └── json-format.md         # Workflow JSON schema
├── workflows/                 # Workflow JSON files
└── README.md                  # This file
```

## Claude Code Skills (installed)

8 skills available in `.agents/skills/`:

| Skill | Purpose |
|-------|---------|
| `n8n-expert` | Carisma-specific n8n expertise (custom) |
| `n8n-expression-syntax` | Expression patterns and common mistakes |
| `n8n-mcp-tools-expert` | How to use n8n MCP tools |
| `n8n-workflow-patterns` | 5 architectural patterns |
| `n8n-validation-expert` | Error classification and fixes |
| `n8n-node-configuration` | Node setup and dependencies |
| `n8n-code-javascript` | Code node JS patterns |
| `n8n-code-python` | Code node Python patterns |

## MCP Server

Add to `.mcp.json` once n8n is running:

```json
"n8n": {
  "command": "npx",
  "args": ["-y", "@czlonkowski/n8n-mcp@latest"],
  "env": {
    "N8N_BASE_URL": "http://localhost:5678",
    "N8N_API_KEY": "your-api-key-from-n8n-settings"
  }
}
```

## Top 5 Workflows to Build

1. **Meta Lead Ads → Zoho CRM → Klaviyo** — Real-time lead pipeline
2. **WhatsApp Booking Assistant** — AI-powered appointment booking
3. **Lead Scoring & Routing** — BANT scoring across 3 brands
4. **Meta Ads Performance Monitor** — Threshold alerts for CEO Cockpit
5. **Wix Form → CRM Routing** — Website form auto-routing
