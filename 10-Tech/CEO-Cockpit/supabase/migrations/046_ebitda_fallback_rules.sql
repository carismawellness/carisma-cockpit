-- ebitda_fallback_rules: which Zoho accounts get TTM-spread smoothing when
-- the user runs a partial-period EBITDA. Accounts in this table with
-- active=true get their period value replaced by:
--   (trailing 12 months total) × (days_in_period / 365)
-- rather than the literal sum of their daily values in [from..to].
-- Cells using fallback get a #cfe2f3 light-blue marker in the EBITDA Export.

CREATE TABLE IF NOT EXISTS ebitda_fallback_rules (
  id            BIGSERIAL PRIMARY KEY,
  zoho_org      TEXT NOT NULL CHECK (zoho_org IN ('spa', 'aesthetics')),
  account_code  TEXT NOT NULL,
  account_name  TEXT NOT NULL,
  rule_type     TEXT NOT NULL DEFAULT 'ttm_spread' CHECK (rule_type IN ('ttm_spread')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zoho_org, account_code)
);

CREATE INDEX IF NOT EXISTS ebitda_fallback_rules_active_idx
  ON ebitda_fallback_rules (active)
  WHERE active = TRUE;

-- Seed: ~70 accounts that need partial-period smoothing per user spec.
-- All start active=true; user can toggle individual rows via the settings page.

INSERT INTO ebitda_fallback_rules (zoho_org, account_code, account_name, rule_type, notes) VALUES
-- RENT (9)
('spa', '000',    'Rent - Labranda',            'ttm_spread', 'Monthly recurring rent'),
('spa', '10001',  'Rent- sunny coast',          'ttm_spread', 'Monthly recurring rent'),
('spa', '619000', 'Rent',                       'ttm_spread', 'Monthly recurring rent'),
('spa', '619110', 'Rent - Ramla Bay',           'ttm_spread', 'Monthly recurring rent'),
('spa', '619121', 'Rent - Excelsior',           'ttm_spread', 'Monthly recurring rent'),
('spa', '619140', 'Rent - InterContinental',    'ttm_spread', 'Monthly recurring rent'),
('spa', '619150', 'Rent - Hyatt Regency',       'ttm_spread', 'Monthly recurring rent'),
('spa', '619160', 'Rent - Hugo''s Hotels',      'ttm_spread', 'Monthly recurring rent'),
('spa', '619500', 'Rent - Motor Vehicle',       'ttm_spread', 'Monthly recurring rent'),

-- UTILITIES (11)
('spa', '100',    'Water & Electricity',                  'ttm_spread', 'Monthly utility bill'),
('spa', '12346',  'Water & Electricity- Sunnycoast.',     'ttm_spread', 'Monthly utility bill'),
('spa', '611511', 'Water & Electricity - InterContinental','ttm_spread','Monthly utility bill'),
('spa', '611521', 'Water & Electricity - Hyatt',          'ttm_spread', 'Monthly utility bill'),
('spa', '611531', 'Water & Electricity - Hugo''s',        'ttm_spread', 'Monthly utility bill'),
('spa', '611561', 'Water & Electricity office',           'ttm_spread', 'Monthly utility bill'),
('spa', '611562', 'Water and Electricity - Labranda',     'ttm_spread', 'Monthly utility bill'),
('spa', '611563', 'Water & Electricity - Novotel',        'ttm_spread', 'Monthly utility bill'),
('spa', '611564', 'Water & Electricity - Excelsior',      'ttm_spread', 'Monthly utility bill'),
('aesthetics', '387729000000000409', 'Telephone Expense',     'ttm_spread', 'Monthly telecom'),
('aesthetics', '387729000000000415', 'IT and Internet Expenses','ttm_spread', 'Monthly IT'),

-- WAGES (14)
('spa', '30001',  'Salaries & Wages - Inter',                     'ttm_spread', 'Monthly payroll'),
('spa', '30002',  'Salaries & Wages - Hugo''s',                   'ttm_spread', 'Monthly payroll'),
('spa', '30003',  'Salaries & Wages - Hyatt',                     'ttm_spread', 'Monthly payroll'),
('spa', '30004',  'Salaries & Wages - Sunny',                     'ttm_spread', 'Monthly payroll'),
('spa', '30005',  'Salaries & Wages - Ramla',                     'ttm_spread', 'Monthly payroll'),
('spa', '30006',  'Salaries & Wages - Labranda',                  'ttm_spread', 'Monthly payroll'),
('spa', '602220', 'Salary & Wages- Center',                       'ttm_spread', 'Monthly payroll'),
('spa', '602221', 'Salaries & Wages - Excelsior',                 'ttm_spread', 'Monthly payroll'),
('spa', '602222', 'Salaries & Wages - Novotel',                   'ttm_spread', 'Monthly payroll'),
('spa', '616100', 'Salaries & Wages',                             'ttm_spread', 'Monthly payroll'),
('spa', '616110', 'Salaries & Wages - Directors',                 'ttm_spread', 'Monthly payroll'),
('spa', '616113', 'Salary & payroll taxes (FS5) Corporative',     'ttm_spread', 'Monthly payroll taxes'),
('aesthetics', '616113', 'Salary & payroll taxes (FS5) Corporative','ttm_spread', 'Monthly payroll taxes'),
('aesthetics', '625411', 'Salaries and Employee Wages',           'ttm_spread', 'Monthly payroll'),

-- LAUNDRY (7) — sga_cleaning, all SPA
('spa', '611514', 'Laundry - InterContinental',      'ttm_spread', 'Monthly laundry service'),
('spa', '611534', 'Laundry - Hugo''s',               'ttm_spread', 'Monthly laundry service'),
('spa', '611544', 'Laundry - Seashells & Qawra',     'ttm_spread', 'Monthly laundry service'),
('spa', '611554', 'Laundry - Ramla Bay',             'ttm_spread', 'Monthly laundry service'),
('spa', '611570', 'Laundry - Excelsior',             'ttm_spread', 'Monthly laundry service'),
('spa', '611572', 'Laundry - Novotel',               'ttm_spread', 'Monthly laundry service'),
('spa', '612520', 'Laundry Expenses',                'ttm_spread', 'Generic laundry catch-all'),

-- TELECOM (1)
('spa', '611540', 'Mobile, Telephone and Communications', 'ttm_spread', 'Monthly mobile/telecom'),

-- INSURANCE (1)
('spa', '400025', 'Car Insurance',                   'ttm_spread', 'Annual or quarterly insurance — TTM-smoothed'),

-- PROFESSIONAL SERVICES (7)
('spa', '611191', 'Accounting - Professional Services','ttm_spread', 'Monthly accounting retainer'),
('spa', '611193', 'Consulting - Professional Services','ttm_spread', 'Recurring consulting'),
('aesthetics', '611192', 'Audit - Professional Services','ttm_spread', 'Annual audit — TTM-smoothed'),
('aesthetics', '611193', 'Consulting - Professional Services','ttm_spread', 'Recurring consulting'),
('spa', '651180', 'Professional Fees',                'ttm_spread', 'Recurring professional fees'),
('spa', '6050005','Subcontractor',                    'ttm_spread', 'Lumpy subcontractor cost'),
('spa', '659177', 'Consulting - The Purest Solutions','ttm_spread', 'Recurring consulting'),

-- BANK FEES & SUBSCRIPTIONS (5)
('spa', '616680', 'Membership & Subscriptions Fee',    'ttm_spread', 'Annual / monthly subscriptions'),
('aesthetics', '616680', 'Membership & Subscriptions Fee','ttm_spread', 'Annual / monthly subscriptions'),
('spa', '616780', 'Bank Fees and Charges',            'ttm_spread', 'Monthly bank fees'),
('aesthetics', '651224', 'Bank Fees and Charges',     'ttm_spread', 'Monthly bank fees'),
('spa', '659174', 'Subscription - The Purest Solutions','ttm_spread', 'Recurring subscription'),
('spa', '659173', 'Computer running cost - The Purest Solutions','ttm_spread', 'Recurring IT cost'),

-- MISC ANNUAL (2)
('spa', '611196', 'Company Registration Fee',         'ttm_spread', 'Annual registration — TTM-smoothed'),
('aesthetics', '611196', 'Company Registration Fee',  'ttm_spread', 'Annual registration — TTM-smoothed'),

-- LUMPY / OCCASIONAL (15)
-- Legal
('spa', '611194', 'Legal - Professional Services',    'ttm_spread', 'Lumpy legal fees'),
('spa', '98765',  'Legal Charges',                    'ttm_spread', 'Lumpy legal fees'),
-- Training
('spa', '616620', 'Training - General',               'ttm_spread', 'Periodic training programs'),
-- Marketing / Advertising
('spa', '611111', 'Marketing - Digital',              'ttm_spread', 'Monthly digital ads'),
('spa', '611112', 'Marketing - Print',                'ttm_spread', 'Occasional print campaigns'),
('spa', '611113', 'Marketing - Advertising',          'ttm_spread', 'Monthly advertising'),
('spa', '659168', 'Advertising and Marketing - The Purest Solutions','ttm_spread', 'Monthly digital ads'),
('aesthetics', '611111', 'Digital - Marketing',       'ttm_spread', 'Monthly digital ads'),
('aesthetics', '611113', 'Advertising - Marketing',   'ttm_spread', 'Monthly advertising'),
-- Repairs & Maintenance
('spa', '14575',  'Repairs & Maintanance - Novotel',  'ttm_spread', 'Lumpy maintenance'),
('spa', '1566',   'Repairs & Maintanance - Labranda', 'ttm_spread', 'Lumpy maintenance'),
('spa', '611141', 'Buildings - Repairs & Maintanance','ttm_spread', 'Lumpy maintenance'),
('spa', '611142', 'Motor Vechiles - Repairs & Maintanance','ttm_spread', 'Lumpy maintenance'),
('spa', '611143', 'Machines & Equipment - Repairs & Maintanance','ttm_spread', 'Lumpy maintenance'),
('spa', '611559', 'Repairs & Maintenance - General',  'ttm_spread', 'Lumpy maintenance'),
('spa', '999',    'Repairs & Maintanance',            'ttm_spread', 'Lumpy maintenance'),

-- SUPPLEMENTARY SALARY (sentinel, monthly)
('spa', 'SUPP_SAL', 'Salary Supplement',              'ttm_spread', 'Monthly supplementary salary (Cockpit feed)'),
('aesthetics', 'SUPP_SAL', 'Salary Supplement',       'ttm_spread', 'Monthly supplementary salary (Cockpit feed)')

ON CONFLICT (zoho_org, account_code) DO NOTHING;
