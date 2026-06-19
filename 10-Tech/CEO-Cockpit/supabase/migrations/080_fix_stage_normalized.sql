-- Fix ghl_opportunities: replace raw GHL stage UUIDs with normalized names.
-- Root cause: GHL /opportunities/search omits pipelineStageName, so the
-- backfill and reconcile stored UUIDs. Confirmed stage map from
-- GET /opportunities/pipelines on 2026-06-11.

-- ── Spa (brand_id = 1) ────────────────────────────────────────────────────
UPDATE ghl_opportunities SET stage_normalized = 'New Leads'    WHERE brand_id = 1 AND stage_normalized = '188e01d4-99aa-43e2-8b9a-8997a2557568';
UPDATE ghl_opportunities SET stage_normalized = 'Call Back'    WHERE brand_id = 1 AND stage_normalized = 'c71348ec-0236-491b-9f47-b6c547d82f22';
UPDATE ghl_opportunities SET stage_normalized = 'Contacted'    WHERE brand_id = 1 AND stage_normalized = '1269df45-f393-475b-a126-8db9e4f2f283';
UPDATE ghl_opportunities SET stage_normalized = 'Booking Won'  WHERE brand_id = 1 AND stage_normalized = 'aa3b53ac-dc6e-47e2-bc05-4cfe8e65251c';
UPDATE ghl_opportunities SET stage_normalized = 'Booking Lost' WHERE brand_id = 1 AND stage_normalized = '5bb020b3-8f55-43d9-9778-4ba14d331fc1';
UPDATE ghl_opportunities SET stage_normalized = 'No Show'      WHERE brand_id = 1 AND stage_normalized = '18b99532-66c1-4ecd-8af8-52cbd59c6d92';
UPDATE ghl_opportunities SET stage_normalized = 'Nurturing'    WHERE brand_id = 1 AND stage_normalized = 'fabe2304-7331-44e9-bdfb-ee26097fc96e';

-- ── Aesthetics (brand_id = 2) ─────────────────────────────────────────────
UPDATE ghl_opportunities SET stage_normalized = 'New Leads'    WHERE brand_id = 2 AND stage_normalized = '8a5da633-c150-43a6-8bad-c40934caafa8';
UPDATE ghl_opportunities SET stage_normalized = 'Call Back'    WHERE brand_id = 2 AND stage_normalized = 'b890428f-d6a6-4057-87bd-619be5a02844';
UPDATE ghl_opportunities SET stage_normalized = 'Contacted'    WHERE brand_id = 2 AND stage_normalized = '49ec294f-8b75-4667-9572-cc291ce0855d';
UPDATE ghl_opportunities SET stage_normalized = 'Booking Won'  WHERE brand_id = 2 AND stage_normalized = 'e4209bea-82d7-4802-ac5d-54fae9523360';
UPDATE ghl_opportunities SET stage_normalized = 'Booking Lost' WHERE brand_id = 2 AND stage_normalized = 'afafed98-adff-4c3d-9d3d-50f72506fa00';
UPDATE ghl_opportunities SET stage_normalized = 'No Show'      WHERE brand_id = 2 AND stage_normalized = 'be9265aa-8003-401e-83a5-35678959cbcc';
UPDATE ghl_opportunities SET stage_normalized = 'Nurturing'    WHERE brand_id = 2 AND stage_normalized = 'bb8522fd-4eb2-47a6-9f4a-a6eced160077';

-- ── Slimming (brand_id = 3) ───────────────────────────────────────────────
UPDATE ghl_opportunities SET stage_normalized = 'New Leads'    WHERE brand_id = 3 AND stage_normalized = 'e2321215-3f53-47ee-b90c-444b632557a1';
UPDATE ghl_opportunities SET stage_normalized = 'Call Back'    WHERE brand_id = 3 AND stage_normalized = '5ac3c6a1-dd73-4a3f-9fb1-c45aa352865a';
UPDATE ghl_opportunities SET stage_normalized = 'Contacted'    WHERE brand_id = 3 AND stage_normalized = '9398dd4d-4d93-4af1-9ace-f7f35e4a1654';
UPDATE ghl_opportunities SET stage_normalized = 'Booking Won'  WHERE brand_id = 3 AND stage_normalized = 'e74d873e-001e-4746-8d55-35787a796ce0';
UPDATE ghl_opportunities SET stage_normalized = 'Active Member' WHERE brand_id = 3 AND stage_normalized = '45e837d3-b906-4e4b-a3aa-af0182c98aa4';
UPDATE ghl_opportunities SET stage_normalized = 'Booking Lost' WHERE brand_id = 3 AND stage_normalized = '889cb211-7c69-466e-88e8-deda84b2f073';
UPDATE ghl_opportunities SET stage_normalized = 'No Show'      WHERE brand_id = 3 AND stage_normalized = '92a71468-ac94-48cd-a881-e5b0199ef354';
UPDATE ghl_opportunities SET stage_normalized = 'Nurturing'    WHERE brand_id = 3 AND stage_normalized = '5d9f2c50-deda-4837-9ae6-d1b82f617af3';

-- ── Same fix for stage events table ──────────────────────────────────────
-- from_stage_normalized
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'New Leads'    WHERE brand_id = 1 AND from_stage_normalized = '188e01d4-99aa-43e2-8b9a-8997a2557568';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Call Back'    WHERE brand_id = 1 AND from_stage_normalized = 'c71348ec-0236-491b-9f47-b6c547d82f22';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Contacted'    WHERE brand_id = 1 AND from_stage_normalized = '1269df45-f393-475b-a126-8db9e4f2f283';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Booking Won'  WHERE brand_id = 1 AND from_stage_normalized = 'aa3b53ac-dc6e-47e2-bc05-4cfe8e65251c';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Booking Lost' WHERE brand_id = 1 AND from_stage_normalized = '5bb020b3-8f55-43d9-9778-4ba14d331fc1';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'No Show'      WHERE brand_id = 1 AND from_stage_normalized = '18b99532-66c1-4ecd-8af8-52cbd59c6d92';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Nurturing'    WHERE brand_id = 1 AND from_stage_normalized = 'fabe2304-7331-44e9-bdfb-ee26097fc96e';

UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'New Leads'    WHERE brand_id = 2 AND from_stage_normalized = '8a5da633-c150-43a6-8bad-c40934caafa8';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Call Back'    WHERE brand_id = 2 AND from_stage_normalized = 'b890428f-d6a6-4057-87bd-619be5a02844';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Contacted'    WHERE brand_id = 2 AND from_stage_normalized = '49ec294f-8b75-4667-9572-cc291ce0855d';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Booking Won'  WHERE brand_id = 2 AND from_stage_normalized = 'e4209bea-82d7-4802-ac5d-54fae9523360';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Booking Lost' WHERE brand_id = 2 AND from_stage_normalized = 'afafed98-adff-4c3d-9d3d-50f72506fa00';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'No Show'      WHERE brand_id = 2 AND from_stage_normalized = 'be9265aa-8003-401e-83a5-35678959cbcc';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Nurturing'    WHERE brand_id = 2 AND from_stage_normalized = 'bb8522fd-4eb2-47a6-9f4a-a6eced160077';

UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'New Leads'    WHERE brand_id = 3 AND from_stage_normalized = 'e2321215-3f53-47ee-b90c-444b632557a1';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Call Back'    WHERE brand_id = 3 AND from_stage_normalized = '5ac3c6a1-dd73-4a3f-9fb1-c45aa352865a';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Contacted'    WHERE brand_id = 3 AND from_stage_normalized = '9398dd4d-4d93-4af1-9ace-f7f35e4a1654';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Booking Won'  WHERE brand_id = 3 AND from_stage_normalized = 'e74d873e-001e-4746-8d55-35787a796ce0';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Active Member' WHERE brand_id = 3 AND from_stage_normalized = '45e837d3-b906-4e4b-a3aa-af0182c98aa4';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Booking Lost' WHERE brand_id = 3 AND from_stage_normalized = '889cb211-7c69-466e-88e8-deda84b2f073';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'No Show'      WHERE brand_id = 3 AND from_stage_normalized = '92a71468-ac94-48cd-a881-e5b0199ef354';
UPDATE ghl_opportunity_stage_events SET from_stage_normalized = 'Nurturing'    WHERE brand_id = 3 AND from_stage_normalized = '5d9f2c50-deda-4837-9ae6-d1b82f617af3';

-- to_stage_normalized
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'New Leads'    WHERE brand_id = 1 AND to_stage_normalized = '188e01d4-99aa-43e2-8b9a-8997a2557568';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Call Back'    WHERE brand_id = 1 AND to_stage_normalized = 'c71348ec-0236-491b-9f47-b6c547d82f22';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Contacted'    WHERE brand_id = 1 AND to_stage_normalized = '1269df45-f393-475b-a126-8db9e4f2f283';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Booking Won'  WHERE brand_id = 1 AND to_stage_normalized = 'aa3b53ac-dc6e-47e2-bc05-4cfe8e65251c';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Booking Lost' WHERE brand_id = 1 AND to_stage_normalized = '5bb020b3-8f55-43d9-9778-4ba14d331fc1';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'No Show'      WHERE brand_id = 1 AND to_stage_normalized = '18b99532-66c1-4ecd-8af8-52cbd59c6d92';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Nurturing'    WHERE brand_id = 1 AND to_stage_normalized = 'fabe2304-7331-44e9-bdfb-ee26097fc96e';

UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'New Leads'    WHERE brand_id = 2 AND to_stage_normalized = '8a5da633-c150-43a6-8bad-c40934caafa8';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Call Back'    WHERE brand_id = 2 AND to_stage_normalized = 'b890428f-d6a6-4057-87bd-619be5a02844';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Contacted'    WHERE brand_id = 2 AND to_stage_normalized = '49ec294f-8b75-4667-9572-cc291ce0855d';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Booking Won'  WHERE brand_id = 2 AND to_stage_normalized = 'e4209bea-82d7-4802-ac5d-54fae9523360';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Booking Lost' WHERE brand_id = 2 AND to_stage_normalized = 'afafed98-adff-4c3d-9d3d-50f72506fa00';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'No Show'      WHERE brand_id = 2 AND to_stage_normalized = 'be9265aa-8003-401e-83a5-35678959cbcc';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Nurturing'    WHERE brand_id = 2 AND to_stage_normalized = 'bb8522fd-4eb2-47a6-9f4a-a6eced160077';

UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'New Leads'    WHERE brand_id = 3 AND to_stage_normalized = 'e2321215-3f53-47ee-b90c-444b632557a1';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Call Back'    WHERE brand_id = 3 AND to_stage_normalized = '5ac3c6a1-dd73-4a3f-9fb1-c45aa352865a';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Contacted'    WHERE brand_id = 3 AND to_stage_normalized = '9398dd4d-4d93-4af1-9ace-f7f35e4a1654';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Booking Won'  WHERE brand_id = 3 AND to_stage_normalized = 'e74d873e-001e-4746-8d55-35787a796ce0';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Active Member' WHERE brand_id = 3 AND to_stage_normalized = '45e837d3-b906-4e4b-a3aa-af0182c98aa4';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Booking Lost' WHERE brand_id = 3 AND to_stage_normalized = '889cb211-7c69-466e-88e8-deda84b2f073';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'No Show'      WHERE brand_id = 3 AND to_stage_normalized = '92a71468-ac94-48cd-a881-e5b0199ef354';
UPDATE ghl_opportunity_stage_events SET to_stage_normalized = 'Nurturing'    WHERE brand_id = 3 AND to_stage_normalized = '5d9f2c50-deda-4837-9ae6-d1b82f617af3';
