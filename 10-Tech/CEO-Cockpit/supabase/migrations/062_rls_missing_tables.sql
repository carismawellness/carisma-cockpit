-- Migration 062: Enable RLS on all public tables that have it disabled.
--
-- This is an internal CEO dashboard — all data access is via authenticated
-- Supabase users or the service_role (ETL/API routes). There are no
-- unauthenticated public-facing pages.
--
-- Policy pattern (matching existing tables like spa_ebitda_daily):
--   • authenticated SELECT → any logged-in user can read
--   • service_role ALL    → ETL scripts can write (also bypasses RLS automatically)
--   • Exceptions: profiles (own row only), ci_chat_history (own rows only)
--
-- Also fixes 3 existing tables that have over-permissive {public} anon policies:
--   coa_split_rules, ebitda_v2_hardwired_rules, ebitda_v2_special_persons

-- ─── 1. Enable RLS on all tables currently disabled ──────────────────────────

ALTER TABLE aesthetics_sales_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_chat_history           ENABLE ROW LEVEL SECURITY;
ALTER TABLE coa_split_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_agent_daily           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebitda_fallback_rules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebitda_v2_hardwired_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebitda_v2_special_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE etl_sync_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_campaigns_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_daily             ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_daily           ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_campaigns_daily      ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE slimming_sales_daily      ENABLE ROW LEVEL SECURITY;
ALTER TABLE slimming_treatments_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE spa_revenue_daily         ENABLE ROW LEVEL SECURITY;
ALTER TABLE spa_revenue_monthly       ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions_raw          ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_coa_mapping          ENABLE ROW LEVEL SECURITY;

-- ─── 2. Fix over-permissive {public} anon policies ───────────────────────────
-- These 3 tables had policies that allowed unauthenticated (public) access.
-- Drop the anon policy and replace with authenticated-only.

DROP POLICY IF EXISTS "anon_read" ON coa_split_rules;
DROP POLICY IF EXISTS "anon_read" ON ebitda_v2_hardwired_rules;
DROP POLICY IF EXISTS "anon_read" ON ebitda_v2_special_persons;

CREATE POLICY "auth_read" ON coa_split_rules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read" ON ebitda_v2_hardwired_rules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read" ON ebitda_v2_special_persons
  FOR SELECT TO authenticated USING (true);

-- ─── 3. Dimension / lookup tables (read-only, any authenticated user) ─────────

CREATE POLICY "auth_read" ON brands
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read" ON locations
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth_read" ON zoho_coa_mapping
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service_all" ON brands
  FOR ALL TO service_role USING (true);

CREATE POLICY "service_all" ON locations
  FOR ALL TO service_role USING (true);

-- ─── 4. ETL-written data tables ───────────────────────────────────────────────

CREATE POLICY "auth_read" ON aesthetics_sales_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON aesthetics_sales_daily
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON crm_agent_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON crm_agent_daily
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON etl_sync_log
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON etl_sync_log
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON google_campaigns_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON google_campaigns_daily
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON klaviyo_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON klaviyo_daily
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON marketing_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON marketing_daily
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON meta_campaigns_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON meta_campaigns_daily
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON slimming_sales_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON slimming_sales_daily
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON slimming_treatments_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON slimming_treatments_daily
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON spa_revenue_daily
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON spa_revenue_daily
  FOR ALL TO service_role USING (true);

CREATE POLICY "auth_read" ON transactions_raw
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON transactions_raw
  FOR ALL TO service_role USING (true);

-- ─── 5. Finance config tables ─────────────────────────────────────────────────

CREATE POLICY "auth_read" ON ebitda_fallback_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_all" ON ebitda_fallback_rules
  FOR ALL TO service_role USING (true);

-- spa_revenue_monthly already has correct policies — just needed ENABLE RLS above

-- ─── 6. Profiles: each user sees only their own row ──────────────────────────
-- API routes use service_role (admin client) for user management, which
-- bypasses RLS — so no service_role policy needed here.

CREATE POLICY "profiles_own" ON profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());

-- ─── 7. CI Chat History: users see and write only their own messages ──────────

CREATE POLICY "ci_chat_own_read" ON ci_chat_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "ci_chat_own_insert" ON ci_chat_history
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
