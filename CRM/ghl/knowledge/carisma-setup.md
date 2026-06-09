# Carisma GHL Setup Reference

This file documents all Carisma-specific GHL configuration: location IDs, pipeline IDs, stage IDs, custom field keys, and API credentials.

---

## Authentication

**Method:** Private Integration Token (PIT)  
**Header:** `Authorization: Bearer <GHL_API_KEY>`  
**Version Header:** `Version: 2021-07-28`  
**Base URL:** `https://services.leadconnectorhq.com`

Credentials are stored in `.env`:
```
GHL_API_KEY=<private integration token>
GHL_LOCATION_ID=<sub-account location ID>
GHL_BASE_URL=https://services.leadconnectorhq.com
```

To get your Location ID: log into GHL → select sub-account → URL will show `locationId=XXXX`.

---

## Sub-Accounts (Locations)

Carisma runs three brands, each as a separate GHL sub-account (location):

| Brand | Location Name | Location ID | MCP Server Name |
|-------|--------------|-------------|-----------------|
| Carisma Spa | Carisma Spa & Wellness | `TrtSnBSSKBOkVVNxJ3AM` | `ghl` |
| Carisma Aesthetics | Carisma Aesthetics | `Goi7kzVK7iwe2woxUHkT` | `ghl-aesthetics` |
| Carisma Slimming | Carisma Slimming | `imWIWDcnmOfijW0lltPq` | `ghl-slimming` |

Each sub-account has its own Private Integration Token (PIT) in `.env`:
- Spa → `GHL_API_KEY`
- Aesthetics → `GHL_API_KEY_AESTHETICS`
- Slimming → `GHL_API_KEY_SLIMMING`

Agency-level access (`search_locations`) returns 403 on these PITs — each
token is location-scoped. Use the brand-specific MCP server when working with
a non-Spa brand.

---

## Pipelines

Each brand's Call Pipeline mirrors the same 7-stage funnel. IDs below.

### Call Pipeline IDs

| Brand | Pipeline ID | 🌱 New Leads | ❌ Booking Lost | ✅ Booking Won |
|-------|------------|--------------|----------------|----------------|
| Spa | `4vgVsqiN12VGdloyzyxD` | `188e01d4-99aa-43e2-8b9a-8997a2557568` | `5bb020b3-8f55-43d9-9778-4ba14d331fc1` | `aa3b53ac-dc6e-47e2-bc05-4cfe8e65251c` |
| Aesthetics | `PaSsbcOAeRURF2Hc2V3F` | `8a5da633-c150-43a6-8bad-c40934caafa8` | `afafed98-adff-4c3d-9d3d-50f72506fa00` | `e4209bea-82d7-4802-ac5d-54fae9523360` |
| Slimming | `N3usvWAkWpUppJj1ggtM` | `e2321215-3f53-47ee-b90c-444b632557a1` | `889cb211-7c69-466e-88e8-deda84b2f073` | `e74d873e-001e-4746-8d55-35787a796ce0` |

### Warm Leads AI Pipeline (Carisma Aesthetics)

**Pipeline ID:** `EUX0sSe7GjR8OJApVZXA`
**Location:** Carisma Aesthetics (`Goi7kzVK7iwe2woxUHkT`)
**Created:** 2026-04-23

| Position | Stage Name | Stage ID |
|----------|-----------|---------|
| 0 | ❄️ COLD Leads (AI Engaged) | `256196ea-8088-46d6-b0ff-ea1cd2206dce` |
| 1 | 👋 Warm Leads | `a2dfd504-1996-4595-b90c-07c0e0eb242c` |
| 2 | 🔥 HOT Leads | `aa975624-1268-414b-9164-46c84d655d18` |
| 3 | ✍️ Manual Followup | `d4d0d1af-c57f-49af-ac87-50edcdda553a` |
| 4 | ✨ AI Followup | `a8dc7c67-fbe6-4ed1-8bf7-23afdb243af4` |
| 5 | ♻️ Recycle List | `2af4da53-14ab-4df2-8911-de04b06903ef` |
| 6 | 📆 Appt Booked | `063614cb-8aa8-44d3-8747-c712f9aaa03e` |
| 7 | ❌ Cancel/No-Show | `f5e59ab8-bea9-4709-ada2-3fff4159d0f5` |
| 8 | ✅ Showed | `c7dd9b75-8a4a-484c-8be4-e5f7d27ce4fe` |

---

### Aesthetics Pipeline (Legacy Spanish Setter System)

Pipeline stages (Spanish — must match exactly in code):

| Stage Name | Meaning |
|-----------|---------|
| `lead nuevo` | New lead, first contact not made |
| `contactado dia 1` | Contacted day 1, no answer |
| `contactado dia 2` | Contacted day 2 |
| `contactado dia 3` | Contacted day 3 |
| `contactado dia 7` | Contacted day 7 |
| `conversacion` | Connected and interested |
| `no show` | Scheduled but didn't attend |
| `cita confirmada` | Booking confirmed ✓ |
| `cualificado` | Qualified/won ✓ |
| `showed` | Showed up for consultation ✓ |
| `nurturing` | Long-term nurture |

**To get pipeline and stage IDs:**
```
ToolSearch → mcp__ghl__get_pipelines
mcp__ghl__get_pipelines(locationId="<LOCATION_ID>")
```

---

## Custom Fields

### Aesthetics Contact Custom Fields

| Label | API Key | Type | Purpose |
|-------|---------|------|---------|
| Followup Count | `followup_count` | Number | Tracks no-answer count (0–4) |
| Task Type | `task_type` | Text | Current active task type |
| Task Outcome | `task_outcome` | Dropdown | Last task outcome |
| Priority Score | `priority_score` | Number | Queue sort order (10–100) |

**Task Outcome dropdown values:**
- `No Answer`
- `Connected - Call Back`
- `Connected - Interested`
- `Connected - Booked`
- `Connected - Reschedule`
- `Connected - Not Interested`

**To get custom field IDs:**
```
ToolSearch → mcp__ghl__get_location_custom_fields
mcp__ghl__get_location_custom_fields(locationId="<LOCATION_ID>")
```

---

## Merge Tags (Personalization Variables)

Use these in SMS/email templates and workflow messages:

### Contact Fields
```
{{contact.first_name}}
{{contact.last_name}}
{{contact.full_name}}
{{contact.email}}
{{contact.phone}}
{{contact.address1}}
{{contact.city}}
{{contact.country}}
{{contact.date_of_birth}}
{{contact.company_name}}
{{contact.source}}
{{contact.tags}}
```

### Custom Field Merge Tags
```
{{contact.followup_count}}
{{contact.task_type}}
{{contact.task_outcome}}
{{contact.priority_score}}
```

### Appointment Fields
```
{{appointment.start_time}}
{{appointment.end_time}}
{{appointment.title}}
{{appointment.notes}}
{{appointment.staff_name}}
```

### Location/Business Fields
```
{{location.name}}
{{location.phone}}
{{location.email}}
{{location.address}}
{{location.website}}
```

---

## Webhook Configuration

The task automation webhook is configured in each sub-account under:
**Settings → Integrations → Webhooks**

Or via a Workflow action: **Webhook → POST** to the handler URL.

Expected payload format:
```json
{
  "contactId": "{{contact.id}}",
  "contactName": "{{contact.name}}",
  "opportunityId": "{{opportunity.id}}",
  "taskId": "{{task.id}}",
  "taskTitle": "{{task.title}}",
  "taskOutcome": "{{contact.task_outcome}}",
  "taskType": "{{contact.task_type}}",
  "followupCount": "{{contact.followup_count}}",
  "assignedTo": "{{task.assignedTo}}",
  "callbackDate": "{{contact.callback_date}}"
}
```

---

## Staff Users & Roles

GHL roles per location:
- **Admin** — Full access to all features
- **User** — Standard rep access (contacts, tasks, conversations)
- **Agency Admin** — Cross-location agency access

To list users: `mcp__ghl__get_location` returns user assignments.

---

## n8n Integration

The daily orchestrator can be scheduled via n8n:
- **Trigger:** Schedule (cron `0 8 * * *`)
- **Action:** Execute Command → `python -m ghl.daily_orchestrator`
- **Or:** HTTP Request → POST to webhook handler

See `Tech/CEO-Cockpit/n8n/` for n8n configuration.

---

## Quick Reference Commands

```bash
# Run daily orchestrator (dry run)
python -m ghl.daily_orchestrator --dry-run

# Run daily orchestrator (live)
python -m ghl.daily_orchestrator

# Start webhook server
uvicorn ghl.webhook_handler:app --host 0.0.0.0 --port 8000

# Install dependencies
pip install -r CRM/ghl/requirements.txt
```

---

## Environment Variables

```bash
# Required
GHL_API_KEY=pit_xxxxxxxxxxxx
GHL_LOCATION_ID=xxxxxxxxxxxxxxxxxxxx

# Optional (defaults shown)
GHL_BASE_URL=https://services.leadconnectorhq.com
```

Copy `.env.example` → `.env` and fill in values before running any scripts.
