-- Longitudinal attendance tracking.
--
-- One row per (employee, date) for every day they are on the published roster.
-- The ETL (/api/etl/attendance-daily) computes is_late / left_early using a
-- 15-minute grace period on both ends. Unrostered employees are never written.
-- Keyed on (employee_id, date) so re-syncing any date window is idempotent.

create table if not exists public.attendance_daily (
  id                 bigserial    primary key,
  employee_id        text         not null,
  employee_name      text         not null,
  date               date         not null,
  -- Raw clock-in / clock-out from Talexio time logs (Malta timezone, HH:MM).
  clock_in           time,
  clock_out          time,
  -- Published roster times (Malta timezone, HH:MM).
  scheduled_start    time,
  scheduled_end      time,
  -- Derived flags (15-minute grace on both ends).
  is_absent          boolean      not null default false,
  is_late            boolean      not null default false,
  left_early         boolean      not null default false,
  minutes_late       integer      not null default 0,
  minutes_early_out  integer      not null default 0,
  hours_worked       numeric(5,2),
  location_name      text,
  synced_at          timestamptz  default now(),
  unique(employee_id, date)
);

create index if not exists idx_attendance_date         on public.attendance_daily(date);
create index if not exists idx_attendance_employee_id  on public.attendance_daily(employee_id);
create index if not exists idx_attendance_is_late      on public.attendance_daily(is_late)    where is_late    = true;
create index if not exists idx_attendance_left_early   on public.attendance_daily(left_early) where left_early = true;

alter table public.attendance_daily enable row level security;

drop policy if exists "attendance_read" on public.attendance_daily;
create policy "attendance_read"
  on public.attendance_daily
  for select
  to authenticated
  using (true);
