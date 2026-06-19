# n8n Integrations for Carisma Wellness Group

## Integration Map

Carisma operates 3 brands (Spa, Aesthetics, Slimming) with shared infrastructure. n8n connects them all.

| Service | n8n Node | Auth Type | Carisma Instance |
|---------|----------|-----------|------------------|
| Zoho CRM (Spa) | `zohocrm` | OAuth2 | CRM-SPA |
| Zoho CRM (Aesthetics) | `zohocrm` | OAuth2 | CRM-AES |
| Zoho CRM (Slimming) | `zohocrm` | OAuth2 | CRM-SLIM |
| Meta Ads | Facebook Lead Ads Trigger | OAuth2 | Single ad account |
| Klaviyo | HTTP Request | API Key | Per-brand lists |
| WhatsApp Business | `whatsapp` | OAuth2 | Business API |
| Google Sheets | `googleSheets` | OAuth2 | KPI/EBITDA sheets |
| Google Calendar | `googleCalendar` | OAuth2 | Appointment booking |
| Trello | `trello` | OAuth2 | Mert's task board |
| Wix | `@wix/n8n-nodes-wix` | API Key | Brand websites |
| Supabase | `supabase` | API Key | CEO Cockpit database |

## Top Workflow Blueprints

### 1. Meta Lead Ads → Zoho CRM → Klaviyo Pipeline

**Purpose:** Real-time lead capture from Facebook ads, routed to correct brand CRM, synced to Klaviyo for email nurturing.

```
Facebook Lead Ads Trigger
  → Extract lead data (name, email, phone, ad campaign)
  → Switch (by campaign name or ad set)
    → Branch: Spa → Zoho CRM (CRM-SPA) Create Lead
    → Branch: Aesthetics → Zoho CRM (CRM-AES) Create Lead  
    → Branch: Slimming → Zoho CRM (CRM-SLIM) Create Lead
  → HTTP Request → Klaviyo Add to List (brand-specific)
  → HTTP Request → Klaviyo Track Event (lead_captured)
  → Trello → Create Card in "Today" list (sales follow-up)
```

**Requirements:**
- Facebook App with `leads_retrieval` + `pages_manage_ads` permissions (needs Meta App Review)
- Zoho CRM OAuth2 credentials per brand
- Klaviyo API key
- Trello OAuth2

### 2. WhatsApp Booking Assistant

**Purpose:** AI-powered conversational booking for all 3 brands via WhatsApp.

```
Webhook (GET) → Respond with hub.challenge (Meta verification)

Webhook (POST) → Filter (incoming messages only)
  → AI Agent (Claude/GPT)
    → Tools: Check Calendar, Book Appointment, Get Services
    → Memory: Redis/Postgres (conversation context per phone number)
  → Switch (action needed?)
    → Book: Google Calendar Create Event → WhatsApp Send Confirmation
    → Info: WhatsApp Send Info Message
    → Human: Forward to agent (complex request)
```

**Key constraints:**
- WhatsApp 24-hour rule: custom messages only within 24h of last incoming
- Outside 24h window: use pre-approved template messages only
- Memory buffer maintains context for returning customers

### 3. Lead Scoring & Routing

**Purpose:** Automated BANT scoring when leads enter any CRM.

```
Zoho CRM Webhook (new lead) → Extract lead data
  → AI Agent (GPT-4/Claude)
    → System prompt: BANT scoring framework
    → Score: Budget (0-25), Authority (0-25), Need (0-25), Timeline (0-25)
  → Switch (by total score)
    → Hot (75-100): Assign to senior rep + Trello "Today" + Slack alert
    → Warm (50-74): Assign to mid-level rep + Klaviyo warm nurture sequence
    → Cold (25-49): Klaviyo cold nurture sequence + revisit in 30 days
    → Disqualified (0-24): Tag in CRM + no action
  → Google Sheets → Log scoring details for reporting
```

### 4. Meta Ads Performance Monitor

**Purpose:** Automated performance checks with threshold-based alerts for CEO Cockpit.

```
Schedule Trigger (every 6 hours)
  → HTTP Request → Meta Graph API (ad-level insights)
  → Code Node (apply thresholds)
    → Underperformer: CTR < 0.5% for 2+ days
    → Top performer: ROAS > 5x
    → Overspend: Daily spend > 120% of budget
  → If (alerts exist?)
    → Slack/Email alert with: ad name, spend, CTR, CPC, ROAS
    → Trello card for action needed
  → Google Sheets → Log all metrics for CEO Cockpit ETL
```

### 5. Wix Form → CRM Routing

**Purpose:** Website form submissions auto-categorized and routed to correct CRM.

```
Wix Trigger (form submission)
  → Extract form data (name, email, phone, service interest)
  → AI Agent or Switch (categorize by service/brand)
    → Spa services → Zoho CRM (CRM-SPA) Create Lead
    → Aesthetics → Zoho CRM (CRM-AES) Create Lead
    → Slimming → Zoho CRM (CRM-SLIM) Create Lead
  → Klaviyo → Add to welcome sequence
  → WhatsApp → Send welcome message (if phone provided)
```

**Note:** Wix integration requires community node: `@wix/n8n-nodes-wix`

## Zoho CRM Integration Details

### Authentication Setup
1. Register app in Zoho API Console as "Server-based Application"
2. Set redirect URI: your n8n instance OAuth callback URL
3. Generate Client ID + Secret
4. Configure in n8n Credentials as "ZOHO OAuth2 API"
5. Create separate credentials for each brand CRM

### Webhook from Zoho
Configure in Zoho CRM → Settings → Automation → Webhooks:
- Point to your n8n webhook URL
- Events: New Lead, Deal Stage Change, Contact Update
- Payload includes all standard + custom fields

### Key Operations
- Create Lead/Contact/Deal
- Get All (with criteria filtering)
- Update records
- Search by email/phone

## Klaviyo Integration (via HTTP Request)

No native node — use HTTP Request with Klaviyo REST API.

**Base URL:** `https://a.klaviyo.com/api/`
**Auth:** API Key header (`Authorization: Klaviyo-API-Key your-private-key`)

### Key Endpoints
- `POST /profiles` — Create/update subscriber
- `POST /events` — Track custom events (triggers Klaviyo flows)
- `POST /lists/{id}/relationships/profiles` — Add to list
- `GET /campaigns` — Pull campaign metrics

## WhatsApp Integration Details

### Two Credential Types
- **WhatsApp API** — For sending messages (action nodes)
- **WhatsApp OAuth Account** — For receiving messages (trigger nodes)

### 24-Hour Rule
- Within 24h of last incoming: send any message
- Outside 24h: only pre-approved template messages
- Templates must be approved by Meta before use

### Chatbot Architecture
Two webhooks needed:
1. **GET** — Meta verification handshake (respond with `hub.challenge`)
2. **POST** — Receive incoming messages, process, respond

## Trello Integration

### Mert's Board Configuration
- **Board ID:** `59353c402ba4c37e186ac1e6`
- **Today list:** `5d683568c8c62b211310b95e`
- **Weekly list:** `5d6835f92d961b2e1495b99f`
- **Work in Progress:** `5d68601d9efca34af4e780cc`

### Common Operations
- Create card (with labels, due dates, checklists)
- Move card between lists
- Add comments
- Create checklist items
- Trigger on card events

## Google Workspace

### Sheets (KPI/EBITDA)
- **Monthly KPIs Sheet:** `1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s`
- **Analytics (Revenue) Sheet:** `1q_aqO9QpCaRoqhOI0Fd41YPO7NMrRAlv5EjShmZK6RM`
- Operations: Read/Write/Append rows, create sheets

### Calendar
- Create/update/delete events
- Check availability
- Trigger on new events
