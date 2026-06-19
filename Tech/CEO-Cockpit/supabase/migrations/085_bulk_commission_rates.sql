-- Migration 085: Bulk commission rates from Staff Master sheet
-- Source: Google Sheets ID 1AAnfm-SAYso6RpJhbdhJbTbcGDH1Ftlk0FHBPHfN98w (Staff master tab)
-- Generated: 2026-06-13
-- Column mapping: S=spa_total, T=service, U=retail, V=booking, X=aesthetics_service, Y=slimming_service
-- Brand logic: Aesthetics/Slimming determined by role col B; everyone else = spa
-- Manager logic: roles containing Manager/Supervisor/Regional/Director use col S for spa_total, service_rate=0
-- All percentages divided by 100 to get decimals

WITH sheet_data (name, service_rate, retail_rate, booking_rate, spa_total_rate) AS (
  VALUES
    -- ============================================================
    -- SPA THERAPISTS & ADVISORS (service=T, retail=U, booking=V)
    -- ============================================================
    ('Milena Lazorova',          0.0700, 0.1500, 0.0500, 0.0000),
    ('Ni Made Ety Diantari',     0.0600, 0.1500, 0.0300, 0.0000),
    ('Ni Made Sudarmini',        0.0600, 0.1500, 0.0300, 0.0000),
    ('Cindy Lorena Varon Prieto',0.0450, 0.1500, 0.0300, 0.0000),
    ('Tamara Videc',             0.0600, 0.1500, 0.0300, 0.0000),
    ('Valeri Kiseev',            0.0600, 0.1500, 0.0500, 0.0000),
    ('Lovely Sison',             0.0450, 0.1500, 0.0300, 0.0000),
    ('Natasha Naumcheska',       0.0600, 0.1500, 0.0300, 0.0000),
    ('Laura Camila',             0.0450, 0.1500, 0.0300, 0.0000),
    ('Lourdes M. De Leon',       0.0300, 0.1500, 0.0300, 0.0000),
    ('Benjawan Phereewong',      0.0300, 0.1500, 0.0300, 0.0000),
    ('SEBASTIJAN LOMSEK',        0.0300, 0.1500, 0.0300, 0.0000),
    ('PAKINEE Kriamthaisong',    0.0450, 0.1500, 0.0300, 0.0000),
    ('CHRISTOPHER RYON OBIEN',   0.0450, 0.1500, 0.0300, 0.0000),
    ('RITA SMITH AZIAH',         0.0508, 0.1500, 0.0000, 0.0127),  -- has both spa_total 1.27% and service 5.08%; treat as dual (include spa_total, service non-zero)
    ('TESSA LAURIO',             0.0450, 0.1500, 0.0300, 0.0000),
    ('SUJINDA. PHEREEWONG',      0.0300, 0.1500, 0.0300, 0.0000),
    ('ELIZABETA ZDRAVKOV',       0.0600, 0.1500, 0.0300, 0.0000),
    ('BLAGOJCHE DAMEVSKI',       0.0600, 0.1500, 0.0300, 0.0000),
    ('Sylvia Arana Gaa',         0.0450, 0.1500, 0.0300, 0.0000),
    ('Marivic Arana Clavo',      0.0600, 0.1500, 0.0300, 0.0000),
    ('Viviane Alexandre',        0.0300, 0.1500, 0.0300, 0.0000),
    ('Vanessa Escobar',          0.0450, 0.1500, 0.0300, 0.0000),
    ('Komang Budarsi',           0.0300, 0.1500, 0.0300, 0.0000),
    ('MADE ANDORIANI',           0.0200, 0.1500, 0.0300, 0.0000),
    ('Karen Tobongbanua',        0.0300, 0.1500, 0.0300, 0.0000),
    ('THAIS LIMA',               0.0254, 0.1500, 0.0254, 0.0000),
    ('WARAPORN PONGRAT',         0.0254, 0.1500, 0.0254, 0.0000),
    ('PATRICIA TOMEI',           0.0254, 0.1271, 0.0254, 0.0000),
    ('JULIANA DEVES',            0.0254, 0.1271, 0.0254, 0.0000),
    ('Deborah Deborah',          0.0254, 0.1271, 0.0254, 0.0000),
    ('SANGAY WANGMO',            0.0254, 0.1271, 0.0254, 0.0000),
    ('GLECILA DETICIO',          0.0254, 0.1271, 0.0254, 0.0000),
    ('Ihebeddin Slama',          0.0254, 0.1271, 0.0254, 0.0000),  -- second/active entry (Dec 2025 rehire)
    ('IGOR GOLUBOVIC',           0.0254, 0.1500, 0.0300, 0.0000),  -- second/active entry (Feb 2026 rehire)
    ('Faviola Andueza',          0.0254, 0.1271, 0.0254, 0.0000),
    ('Kunyapak phonsing',        0.0300, 0.1500, 0.0300, 0.0000),
    -- ============================================================
    -- SPA ADVISORS / CONCIERGE (service=T, retail=U, booking=V)
    -- ============================================================
    ('JOVANA MARKOVIC',          0.0000, 0.1500, 0.0000, 0.0000),  -- Supervisor/Reception; service blank, retail 15%, booking blank
    ('NATALIA ROMERO',           0.0000, 0.1500, 0.0300, 0.0000),  -- Advisor; service blank, retail 15%, booking 3%
    ('NATHALIA BARRETO',         0.0000, 0.1500, 0.0300, 0.0000),
    ('MAILA MAILA',              0.0000, 0.1500, 0.0300, 0.0000),
    ('Alana Donovan',            0.0000, 0.1500, 0.0300, 0.0000),
    ('Maria Oliveira',           0.0000, 0.1500, 0.0254, 0.0000),
    ('Gulnaz Khanam',            0.0000, 0.1500, 0.0254, 0.0000),
    ('Lenara Ribeiro',           0.0000, 0.1500, 0.0300, 0.0000),
    ('Sofia Gonzalez Fernandez', 0.0000, 0.1500, 0.0300, 0.0000),
    ('ANJA BOGDANOVIC',          0.0000, 0.1271, 0.0254, 0.0000),
    ('DANIELA XAVIER',           0.0000, 0.1271, 0.0254, 0.0000),
    ('GABRIELY PRADO',           0.0000, 0.1271, 0.0254, 0.0000),
    ('PRAISE UWAGBOE',           0.0000, 0.1271, 0.0254, 0.0000),
    ('JEAN RIVERA',              0.0000, 0.1271, 0.0254, 0.0000),
    ('Kemi Onakoya',             0.0000, 0.1271, 0.0254, 0.0000),
    ('Seema Prasad',             0.0000, 0.1271, 0.0254, 0.0000),
    ('Ruksana Shakir',           0.0000, 0.1500, 0.0000, 0.0000),  -- Senior Accountant / Management
    ('Gianni Marcal Casotti',    0.0300, 0.1500, 0.0300, 0.0000),  -- CRM Manager — has real commission; service=T 3%, retail=U 15%, booking=V 3%
    ('Kristinaa Alisauskaite',   0.0600, 0.1500, 0.0000, 0.0150),  -- Supervisor; spa_total=1.5%, service=6%, retail=15%
    -- ============================================================
    -- SPA MANAGERS (spa_total=S, retail=U, booking=V, service=0)
    -- ============================================================
    ('Anna Maria Mirisola',      0.0000, 0.1500, 0.0000, 0.0150),
    ('Melanie Mitic Vella',      0.0000, 0.1500, 0.0000, 0.0150),
    ('Neli Radeva',              0.0300, 0.1500, 0.0000, 0.0150),  -- Regional Manager; service col T = 3%, spa_total = 1.5%
    ('NATASHA MARJANOVIC',       0.0700, 0.1500, 0.0000, 0.0150),  -- Supervisor; service=7%, spa_total=1.5%
    ('FLORA SANTANA',            0.0000, 0.1500, 0.0000, 0.0150),  -- Supervisor/Spa Advisor
    ('Natalia Linares',          0.0000, 0.1500, 0.0000, 0.0150),  -- Supervisor; spa_total=1.5%
    ('AKAUKSHA BOQKAQ',          0.0254, 0.1271, 0.0000, 0.0127),  -- Supervisor; spa_total=1.27%, service=2.54%
    ('Mandar Rajesh Talele',     0.0000, 0.1500, 0.0300, 0.0000),  -- Management
    ('Melissa Castellino',       0.0000, 0.1500, 0.0300, 0.0000),  -- Management
    ('Sinan Tefik',              0.0000, 0.1500, 0.0000, 0.0000),  -- Management / Exec team
    -- ============================================================
    -- AESTHETICS EMPLOYEES (service=X, retail=U, booking=0, spa_total=0)
    -- ============================================================
    ('Leticia Bonassi',          0.0300, 0.1500, 0.0000, 0.0000),
    ('Adriene Paula',            0.0450, 0.1500, 0.0000, 0.0000),
    ('KENDRA FARUGGIA',          0.0000, 0.1271, 0.0000, 0.0000),  -- Aesthetics; X col = blank, U = 12.71%
    ('Dr Giovanni',              0.4000, 0.1271, 0.0000, 0.0000),  -- Aesthetics; X=40%
    ('Dr Fran',                  0.3000, 0.1271, 0.0000, 0.0000),  -- Aesthetics; X=30%
    -- ============================================================
    -- SLIMMING EMPLOYEES (service=Y, retail=U, booking=0, spa_total=0)
    -- ============================================================
    ('DIANA HERRERA',            0.0254, 0.0085, 0.0000, 0.0000),  -- Slimming; Y=2.54%, U=0.85%
    ('BRUNNA TAVARES',           0.0254, 0.0169, 0.0000, 0.0000),  -- Slimming; Y=2.54%, U=1.69%
    ('Ivana Boskovic',           0.0000, 0.1271, 0.0000, 0.0000)   -- Slimming; Y blank, U=12.71%
)
INSERT INTO sales_employee_commission_rates
  (employee_id, service_rate, retail_rate, booking_rate, spa_total_rate, effective_from)
SELECT
  se.id,
  sd.service_rate,
  sd.retail_rate,
  sd.booking_rate,
  sd.spa_total_rate,
  '2025-01-01'::date
FROM sheet_data sd
JOIN sales_employees se
  ON UPPER(TRIM(se.display_name)) = UPPER(TRIM(sd.name))
ON CONFLICT (employee_id, effective_from)
DO UPDATE SET
  service_rate   = EXCLUDED.service_rate,
  retail_rate    = EXCLUDED.retail_rate,
  booking_rate   = EXCLUDED.booking_rate,
  spa_total_rate = EXCLUDED.spa_total_rate;
