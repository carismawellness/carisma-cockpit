-- Sales targets
INSERT INTO kpi_targets (department, metric_name, target_value, comparison) VALUES
  ('sales', 'retail_pct', 12.0, 'gt'),
  ('sales', 'addon_pct', 4.0, 'gt'),
  ('sales', 'hotel_capture_pct', 5.0, 'gt');

-- Marketing targets
INSERT INTO kpi_targets (department, metric_name, target_value, comparison) VALUES
  ('marketing', 'roas', 5.0, 'gt'),
  ('marketing', 'email_revenue_pct', 35.0, 'gt'),
  ('marketing', 'popup_capture_pct', 8.0, 'gt');

-- Marketing targets per brand
INSERT INTO kpi_targets (department, metric_name, target_value, comparison, brand_id) VALUES
  ('marketing', 'cpl', 8.0, 'lt', (SELECT id FROM brands WHERE slug = 'spa')),
  ('marketing', 'cpl', 12.0, 'lt', (SELECT id FROM brands WHERE slug = 'aesthetics')),
  ('marketing', 'cpl', 10.0, 'lt', (SELECT id FROM brands WHERE slug = 'slimming'));

-- CRM targets
INSERT INTO kpi_targets (department, metric_name, target_value, comparison) VALUES
  ('crm', 'speed_to_lead_min', 5.0, 'lt'),
  ('crm', 'conversion_rate_pct', 25.0, 'gt'),
  ('crm', 'workable_leads_per_sdr', 60.0, 'gt'),
  ('crm', 'daily_appointments_booked_min', 8.0, 'gt'),
  ('crm', 'daily_appointments_booked_max', 10.0, 'gt'),
  ('crm', 'lead_to_booking_conversion_pct', 20.0, 'gt');

-- HR targets
INSERT INTO kpi_targets (department, metric_name, target_value, comparison) VALUES
  ('hr', 'hc_pct', 40.0, 'lt'),
  ('hr', 'utilization_pct', 75.0, 'gt'),
  ('hr', 'therapist_mgmt_ratio', 3.0, 'gt');

-- Aesthetics targets
INSERT INTO kpi_targets (department, metric_name, target_value, comparison) VALUES
  ('operations', 'consult_conversion_pct_aes', 50.0, 'gt'),
  ('operations', 'aov_aes', 245.0, 'gt'),
  ('operations', 'consults_per_week_aes', 70.0, 'gt');

-- Slimming targets
INSERT INTO kpi_targets (department, metric_name, target_value, comparison) VALUES
  ('operations', 'course_conversion_pct', 65.0, 'gt'),
  ('operations', 'max_course_conversion_pct', 12.5, 'gt'),
  ('operations', 'bookings_per_therapist', 45.0, 'gt'),
  ('operations', 'consult_showup_pct', 85.0, 'gt'),
  ('operations', 'retail_pct_slim', 20.0, 'gt');
