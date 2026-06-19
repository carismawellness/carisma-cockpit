-- We360.ai employee productivity / attendance ETL target.
--
-- Source: We360 Dynamic Report API
--   POST https://api.in.we360.ai/query/external/reports/dynamic_report
--   (mode "detailed" → one row per employee per day).
--
-- Keyed on (email, attendance_date) so re-syncing a date window UPSERTs
-- cleanly. Self-contained (no staff-dimension FK) to stay robust as the
-- We360 roster changes — join to staff/locations downstream by email if
-- needed. Durations are stored as integer seconds (parsed from the API's
-- "H:MM:SS" strings); percentages as numeric.

create table if not exists public.we360_productivity_daily (
  id                       bigserial primary key,
  attendance_date          date    not null,
  email                    text    not null,
  first_name               text,
  last_name                text,
  group_name               text,
  shift_name               text,
  punch_in                 timestamptz,
  punch_out                timestamptz,
  online_duration_sec      integer,
  active_duration_sec      integer,
  idle_duration_sec        integer,
  productive_duration_sec  integer,
  unproductive_duration_sec integer,
  neutral_duration_sec     integer,
  break_duration_sec       integer,
  active_percent           numeric(5,2),
  productive_percent       numeric(5,2),
  idle_percent             numeric(5,2),
  mouse_clicks             integer,
  key_presses              integer,
  top_application_used     text,
  top_url_used             text,
  synced_at                timestamptz default now(),
  unique(email, attendance_date)
);

create index if not exists idx_we360_prod_date  on public.we360_productivity_daily(attendance_date);
create index if not exists idx_we360_prod_email on public.we360_productivity_daily(email);

alter table public.we360_productivity_daily enable row level security;

-- Read access for authenticated dashboard users; writes via service role only.
drop policy if exists "we360_prod_read" on public.we360_productivity_daily;
create policy "we360_prod_read"
  on public.we360_productivity_daily
  for select
  to authenticated
  using (true);
