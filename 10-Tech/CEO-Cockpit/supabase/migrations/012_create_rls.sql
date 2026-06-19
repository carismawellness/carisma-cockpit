-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_by_rep ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_by_rep ENABLE ROW LEVEL SECURITY;
ALTER TABLE speed_to_lead_distribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE gsc_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebitda_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_vs_actual ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE we360_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapist_utilization ENABLE ROW LEVEL SECURITY;
ALTER TABLE operations_weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE consult_funnel ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ci_chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE etl_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_targets ENABLE ROW LEVEL SECURITY;

-- Helper: get current user role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get current user brand access
CREATE OR REPLACE FUNCTION get_user_brands()
RETURNS TEXT[] AS $$
  SELECT brands_access FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- CEO sees everything; others see their brands
-- Dimension tables: everyone can read
CREATE POLICY "brands_read" ON brands FOR SELECT USING (true);
CREATE POLICY "locations_read" ON locations FOR SELECT USING (true);
CREATE POLICY "staff_read" ON staff FOR SELECT USING (true);
CREATE POLICY "kpi_targets_read" ON kpi_targets FOR SELECT USING (true);

-- Profiles: users see their own
CREATE POLICY "profiles_own" ON profiles FOR SELECT
  USING (id = auth.uid() OR get_user_role() = 'ceo');

-- Data tables: filter by brand access
CREATE POLICY "sales_weekly_read" ON sales_weekly FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() IN ('sales_head', 'finance_head') AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "sales_by_rep_read" ON sales_by_rep FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'sales_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "crm_daily_read" ON crm_daily FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'sales_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "crm_by_rep_read" ON crm_by_rep FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'sales_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "stl_dist_read" ON speed_to_lead_distribution FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'sales_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "marketing_daily_read" ON marketing_daily FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'marketing_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "ga4_daily_read" ON ga4_daily FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'marketing_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "gsc_daily_read" ON gsc_daily FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'marketing_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "klaviyo_read" ON klaviyo_campaigns FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'marketing_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "ebitda_read" ON ebitda_monthly FOR SELECT USING (
  get_user_role() IN ('ceo', 'finance_head')
);

CREATE POLICY "budget_read" ON budget_vs_actual FOR SELECT USING (
  get_user_role() IN ('ceo', 'finance_head')
);

CREATE POLICY "hr_weekly_read" ON hr_weekly FOR SELECT USING (
  get_user_role() IN ('ceo', 'hr_head', 'finance_head')
);

CREATE POLICY "we360_read" ON we360_daily FOR SELECT USING (
  get_user_role() IN ('ceo', 'hr_head')
);

CREATE POLICY "therapist_util_read" ON therapist_utilization FOR SELECT USING (
  get_user_role() IN ('ceo', 'hr_head', 'ops_head')
);

CREATE POLICY "ops_weekly_read" ON operations_weekly FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'ops_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

CREATE POLICY "consult_funnel_read" ON consult_funnel FOR SELECT USING (
  get_user_role() = 'ceo'
  OR (get_user_role() = 'ops_head' AND
      (SELECT slug FROM brands WHERE id = brand_id) = ANY(get_user_brands()))
);

-- CI alerts: CEO sees all, dept heads see their department
CREATE POLICY "ci_alerts_read" ON ci_alerts FOR SELECT USING (
  get_user_role() = 'ceo'
  OR department = REPLACE(get_user_role()::TEXT, '_head', '')
);

-- CI chat: users see their own messages
CREATE POLICY "ci_chat_own" ON ci_chat_history FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "ci_chat_insert" ON ci_chat_history FOR INSERT WITH CHECK (user_id = auth.uid());

-- ETL log: CEO and all heads can view
CREATE POLICY "etl_log_read" ON etl_sync_log FOR SELECT USING (
  get_user_role() != 'viewer'
);

-- Service role bypass for ETL writes (service_role key bypasses RLS automatically)
