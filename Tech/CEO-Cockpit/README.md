# Carisma CEO Cockpit

Business intelligence dashboard for Carisma Wellness Group.

## Setup

### 1. Supabase

1. Create a Supabase project at https://supabase.com
2. Run migrations in order: `cockpit/supabase/migrations/001_*.sql` through `012_*.sql`
3. Run seed files: `cockpit/supabase/seed/001_*.sql` through `003_*.sql`
4. Copy project URL and anon key

### 2. Environment

```bash
cp .env.local.example .env.local
# Fill in Supabase URL, anon key, service role key, and Anthropic API key
```

### 3. Install & Run

```bash
cd cockpit
npm install
npm run dev
```

Open http://localhost:3000

### 4. Create First User

In Supabase Dashboard > Authentication > Users > Create User with email/password.
Then update their profile role:

```sql
UPDATE profiles SET role = 'ceo', full_name = 'Mert Gulen' WHERE id = '<user-uuid>';
```

### 5. ETL Setup

```bash
cd cockpit/etl
pip install -r requirements.txt
```

ETL scripts are invoked by Claude Code scheduled triggers. See `docs/plans/2026-04-14-ceo-cockpit-design.md` for schedule.

## Tech Stack

- **Frontend:** Next.js 16 + Tailwind v4 + shadcn/ui + Recharts
- **Database:** Supabase (PostgreSQL + Auth + RLS)
- **ETL:** Python 3.11
- **CI Engine:** Claude API + Gmail/Meta/Trello/WhatsApp MCP
