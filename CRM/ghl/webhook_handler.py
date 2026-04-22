"""
GHL Webhook Handler — FastAPI endpoints for task-completed and lead-optin events.

Endpoints:
  POST /webhook/task-completed  — fires when a setter marks a task complete
  POST /webhook/lead-optin      — fires when a new Meta Ads lead opts in

To configure in GHL:
  Settings → Integrations → Webhooks → Add Webhook
  task-completed URL: https://<your-domain>/webhook/task-completed
  lead-optin URL:     https://<your-domain>/webhook/lead-optin

Run with:
  uvicorn ghl.webhook_handler:app --host 0.0.0.0 --port 8000

Environment variables:
  GHL_WEBHOOK_SECRET  — optional HMAC secret for signature verification
  GHL_BRAND           — brand sub-account: "spa" | "aesthetics" | "slimming"
"""

import hashlib
import hmac
import logging
import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel

load_dotenv()

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

GHL_WEBHOOK_SECRET = os.getenv("GHL_WEBHOOK_SECRET", "")

# Which brand sub-account this server instance serves: "spa" | "aesthetics" | "slimming"
GHL_BRAND = os.getenv("GHL_BRAND", "aesthetics")

app = FastAPI(title="Carisma GHL Task Webhook", version="2.0.0")


# ── Signature verification ─────────────────────────────────────────────────────

def _verify_signature(raw_body: bytes, signature_header: Optional[str]) -> None:
    if not GHL_WEBHOOK_SECRET:
        return  # Verification disabled
    if not signature_header:
        raise HTTPException(status_code=401, detail="Missing X-GHL-Signature header")
    expected = hmac.new(GHL_WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature_header):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")


# ── Task-type inference from subject ──────────────────────────────────────────

_SUBJECT_TO_TYPE = {
    "first contact":           "First Contact",
    "follow-up 1":             "Follow-up 1",
    "follow-up 2":             "Follow-up 2",
    "follow-up 3":             "Follow-up 3",
    "follow-up 4":             "Follow-up 4",
    "reschedule call":         "Reschedule Call",
    "scheduled callback":      "Scheduled Callback",
    "nurturing check-in":      "Nurturing Re-engagement",
    "reactivation":            "Reactivation",
}


def _infer_task_type(title: Optional[str]) -> Optional[str]:
    if not title:
        return None
    lower = title.lower()
    for keyword, task_type in _SUBJECT_TO_TYPE.items():
        if keyword in lower:
            return task_type
    return None


# ── Payload schemas ────────────────────────────────────────────────────────────

class TaskCompletedPayload(BaseModel):
    """
    Expected fields from GHL webhook when a task is completed.
    Outcome values: "Follow Up", "Booking", "Booking Lost", "Nurture", "Lost"
    """
    contactId:     Optional[str] = None
    contact_id:    Optional[str] = None           # alternate key
    opportunityId: Optional[str] = None
    taskId:        Optional[str] = None
    task_id:       Optional[str] = None
    taskTitle:     Optional[str] = None           # task subject — used to infer task_type
    taskOutcome:   Optional[str] = None           # setter dropdown value
    task_outcome:  Optional[str] = None
    taskType:      Optional[str] = None           # custom field value
    task_type:     Optional[str] = None
    callbackDate:  Optional[str] = None           # for Scheduled Callback tasks
    assignedTo:    Optional[str] = None
    contactName:   Optional[str] = None
    followupCount: Optional[int] = None

    class Config:
        extra = "allow"                           # ignore unknown fields


class LeadOptinPayload(BaseModel):
    """
    Expected fields from GHL lead-optin webhook.
    Fires when a new Meta Ads lead opts in, OR when a new lead enters the pipeline.
    """
    contactId:      Optional[str] = None
    contact_id:     Optional[str] = None
    contactName:    Optional[str] = None
    contact_name:   Optional[str] = None
    email:          Optional[str] = None          # {{contact.email}} in GHL workflow
    phone:          Optional[str] = None          # {{contact.phone}} in GHL workflow
    firstName:      Optional[str] = None
    first_name:     Optional[str] = None
    lastName:       Optional[str] = None
    last_name:      Optional[str] = None
    opportunityId:  Optional[str] = None
    opportunity_id: Optional[str] = None
    assignedTo:     Optional[str] = None
    assigned_to:    Optional[str] = None
    utmContent:     Optional[str] = None
    utm_content:    Optional[str] = None
    utmCampaign:    Optional[str] = None
    utm_campaign:   Optional[str] = None
    formName:       Optional[str] = None
    form_name:      Optional[str] = None
    # brand override — if omitted uses GHL_BRAND env var
    brand:          Optional[str] = None
    # Klaviyo list override — if omitted uses KLAVIYO_LIST_ID env var
    klaviyoListId:  Optional[str] = None

    class Config:
        extra = "allow"


# ── /webhook/task-completed ────────────────────────────────────────────────────

@app.post("/webhook/task-completed")
async def task_completed(
    request: Request,
    x_ghl_signature: Optional[str] = Header(default=None, alias="X-GHL-Signature"),
):
    """
    Fires when a setter marks a task as complete.
    Reads the outcome (Follow Up / Booking / Booking Lost / Nurture / Lost)
    and takes the correct next action.
    """
    raw_body = await request.body()
    _verify_signature(raw_body, x_ghl_signature)

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    payload = TaskCompletedPayload(**data)

    contact_id   = payload.contactId or payload.contact_id
    opp_id       = payload.opportunityId
    task_id      = payload.taskId or payload.task_id
    assignee_id  = payload.assignedTo
    contact_name = payload.contactName or "Unknown"
    followup_count = payload.followupCount or 0

    # Resolve task type (used for logging context)
    task_type = (
        payload.taskType
        or payload.task_type
        or _infer_task_type(payload.taskTitle)
    )

    # Resolve outcome
    outcome = payload.taskOutcome or payload.task_outcome

    if not contact_id:
        log.warning("Webhook received with no contactId — ignoring. Payload: %s", data)
        return {"status": "ignored", "reason": "no contactId"}

    if not outcome:
        log.warning("Webhook for contact %s has no outcome — ignoring.", contact_id)
        return {"status": "ignored", "reason": "no outcome"}

    log.info(
        "Webhook task-completed: contact=%s | task=%s | type=%s | outcome=%s | followup_count=%d",
        contact_id, task_id, task_type or "?", outcome, followup_count
    )

    from .client import GHLClient
    from .task_engine import handle_task_outcome

    client = GHLClient()
    new_task_id = handle_task_outcome(
        client=client,
        outcome=outcome,
        current_task_type=task_type or "",
        contact_id=contact_id,
        contact_name=contact_name,
        followup_count=followup_count,
        assignee_id=assignee_id,
        opp_id=opp_id,
        callback_date=payload.callbackDate,
    )

    return {
        "status":      "ok",
        "contact_id":  contact_id,
        "outcome":     outcome,
        "next_task_id": new_task_id,
    }


# ── /webhook/lead-optin ────────────────────────────────────────────────────────
#
# Configure in GHL workflow "Ad Optin" (after "Create Opportunity" step):
#   POST https://<your-domain>/webhook/lead-optin
#   Body fields:
#     contactId:     {{contact.id}}
#     contactName:   {{contact.name}}
#     opportunityId: {{opportunity.id}}
#     assignedTo:    {{opportunity.assignedTo}}
#     utmContent:    {{contact.utm_content}}
#     utmCampaign:   {{contact.utm_campaign}}
#     formName:      {{contact.source}}

@app.post("/webhook/lead-optin")
async def lead_optin(
    request: Request,
    x_ghl_signature: Optional[str] = Header(default=None, alias="X-GHL-Signature"),
):
    """
    Fires when a new Meta Ads lead opts in via a form.

    Two actions:
      1. Resolve the offer's monetary value and patch it onto the CRM opportunity.
      2. Supersede any existing tasks and create a First Contact task due today.

    Returns: { task_id, contact_id, opportunity_id, status }
    """
    raw_body = await request.body()
    _verify_signature(raw_body, x_ghl_signature)

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    payload = LeadOptinPayload(**data)

    contact_id   = payload.contactId  or payload.contact_id
    contact_name = payload.contactName or payload.contact_name or "Unknown"
    opp_id       = payload.opportunityId or payload.opportunity_id
    assignee_id  = None  # roster.pick_assignee() handles this in create_next_task
    utm_content  = payload.utmContent or payload.utm_content or ""
    form_name    = payload.formName   or payload.form_name   or ""
    brand        = payload.brand      or GHL_BRAND

    if not contact_id:
        log.warning("lead-optin: no contactId in payload — ignoring")
        return {"status": "ignored", "reason": "no contactId"}

    from .config import resolve_lead_value, resolve_treatment_name
    from .config import CUSTOM_FIELD_TREATMENT_INTEREST, CUSTOM_FIELD_LEAD_VALUE
    from .client import GHLClient
    from .task_engine import create_first_contact_task

    client = GHLClient()

    # ── Resolve and patch monetary value ──────────────────────────────────────
    signal_text      = f"{utm_content} {form_name}".strip()
    monetary_value   = resolve_lead_value(brand, utm_content=utm_content, form_name=form_name)
    treatment_name   = resolve_treatment_name(utm_content=utm_content, form_name=form_name)

    log.info(
        "lead-optin: contact=%s opp=%s brand=%s signal=%r → €%d (%s)",
        contact_id, opp_id, brand, signal_text, monetary_value, treatment_name or "unknown",
    )

    if opp_id:
        try:
            client.patch_opportunity_value(opp_id, monetary_value)
            log.info("  Patched opportunity %s → €%d", opp_id, monetary_value)
        except Exception as exc:
            log.error("  Failed to patch opportunity %s: %s", opp_id, exc)
    else:
        # Opportunity not yet created — find the most recent open one for this contact
        try:
            opps = client.get_contact_opportunities(contact_id)
            open_opps = [o for o in opps if o.get("status") == "open"]
            if open_opps:
                opp_id = open_opps[0]["id"]
                client.patch_opportunity_value(opp_id, monetary_value)
                log.info("  Patched latest opportunity %s → €%d", opp_id, monetary_value)
            else:
                log.warning("  No open opportunity found for contact %s — value not set", contact_id)
        except Exception as exc:
            log.error("  Error finding opportunities for %s: %s", contact_id, exc)

    # ── Set treatment_interest and lead_value on contact ─────────────────────
    custom_updates = [
        {"key": CUSTOM_FIELD_LEAD_VALUE, "field_value": str(monetary_value)},
    ]
    if treatment_name:
        custom_updates.append({"key": CUSTOM_FIELD_TREATMENT_INTEREST, "field_value": treatment_name})
    try:
        client.update_contact(contact_id, {"customFields": custom_updates})
        log.info("  Set treatment_interest=%r lead_value=%d on contact %s", treatment_name, monetary_value, contact_id)
    except Exception as exc:
        log.error("  Failed to set treatment/value fields on contact %s: %s", contact_id, exc)

    # ── Supersede + create First Contact task ─────────────────────────────────
    task_id = create_first_contact_task(
        client,
        contact_id=contact_id,
        contact_name=contact_name,
        assignee_id=assignee_id,
        opp_id=opp_id,
    )

    # ── Klaviyo: subscribe lead to email list ─────────────────────────────────
    klaviyo_ok = False
    try:
        from klaviyo.client import KlaviyoClient

        # Resolve email — use payload field if GHL workflow sends it,
        # otherwise fall back to a contact fetch (one extra API call).
        email = payload.email
        first_name = payload.firstName or payload.first_name or ""
        last_name  = payload.lastName  or payload.last_name  or ""
        phone      = payload.phone or ""

        if not email and contact_id:
            contact_data = client.get_contact(contact_id)
            email      = contact_data.get("email", "")
            first_name = first_name or contact_data.get("firstName", "")
            last_name  = last_name  or contact_data.get("lastName", "")
            phone      = phone      or contact_data.get("phone", "")

        if email:
            kv = KlaviyoClient()
            klaviyo_ok = kv.subscribe_to_list(
                email=email,
                first_name=first_name,
                last_name=last_name,
                phone=phone,
                list_id=payload.klaviyoListId or None,
            )
            log.info("klaviyo sync for contact %s (%s): %s", contact_id, email, "ok" if klaviyo_ok else "failed")
        else:
            log.warning("klaviyo sync: no email for contact %s — skipped", contact_id)
    except Exception as exc:
        log.error("klaviyo sync error for contact %s: %s", contact_id, exc)

    return {
        "status":         "ok",
        "contact_id":     contact_id,
        "opportunity_id": opp_id,
        "task_id":        task_id,
        "brand":          brand,
        "monetary_value": monetary_value,
        "signal":         signal_text.strip(),
        "klaviyo_synced": klaviyo_ok,
    }


@app.get("/health")
def health():
    return {"status": "ok"}
