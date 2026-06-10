-- Token storage for third-party API integrations
create table if not exists public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  platform text not null,               -- 'meta_ads', 'google_ads', etc.
  brand_id integer references public.brands(id),
  token text not null,
  refresh_token text,
  expires_at timestamptz,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(platform, brand_id)
);

-- RLS: only service role can access tokens
alter table public.integration_tokens enable row level security;

-- No public access policies — tokens are only accessed server-side via service role
