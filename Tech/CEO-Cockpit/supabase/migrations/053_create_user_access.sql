-- Invitation whitelist — only emails in this table may register
CREATE TABLE IF NOT EXISTS user_invitations (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email       text        UNIQUE NOT NULL,
  is_active   boolean     DEFAULT true NOT NULL,
  created_at  timestamptz DEFAULT now() NOT NULL
);

-- Per-user, per-dashboard access toggles (keyed by email, pre-populated by admin)
CREATE TABLE IF NOT EXISTS user_dashboard_permissions (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email         text        NOT NULL,
  dashboard_key text        NOT NULL,
  has_access    boolean     DEFAULT false NOT NULL,
  updated_at    timestamptz DEFAULT now() NOT NULL,
  UNIQUE (email, dashboard_key)
);

ALTER TABLE user_invitations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_dashboard_permissions ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own invitation status (for registration check)
CREATE POLICY "invitation_select_own"
  ON user_invitations FOR SELECT
  USING (email = auth.jwt() ->> 'email');

-- Authenticated users can read their own dashboard permissions
CREATE POLICY "permissions_select_own"
  ON user_dashboard_permissions FOR SELECT
  USING (email = auth.jwt() ->> 'email');
