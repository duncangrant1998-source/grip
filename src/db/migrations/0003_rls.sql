-- Grip — 0003 — row-level security.
--
-- This migration is the tenant boundary. Application code is not trusted to
-- add `WHERE tenant_id = ...`; Postgres enforces it.
--
-- Every policy uses grip.tenant_visible() for BOTH `USING` and `WITH CHECK`.
-- `USING` stops a tenant reading another's rows; `WITH CHECK` stops it
-- *writing* one — the half that read-side filtering alone misses, and the
-- easier of the two to get wrong.
--
-- Note there is no FORCE ROW LEVEL SECURITY: the table owner deliberately
-- bypasses RLS so migrations, seeds and test fixtures can work across tenants.
-- The owner connection is never used to serve a request.

-- ---------------------------------------------------------------------------
-- Authentication, as controlled SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
-- Login is a chicken-and-egg problem: to scope a query to a tenant you must
-- know the tenant, and you learn it by looking up the user. Rather than leave
-- `users` readable without a tenant — a hole wide enough to enumerate every
-- shop's staff — the two pre-auth lookups are narrow SECURITY DEFINER
-- functions. They are the only way into those tables without a tenant.

CREATE OR REPLACE FUNCTION grip.find_users_for_login(p_email text)
RETURNS TABLE (
  user_id       uuid,
  tenant_id     uuid,
  tenant_name   text,
  tenant_slug   text,
  tenant_status grip.tenant_status,
  password_hash text,
  full_name     text,
  role          grip.user_role,
  is_platform_admin boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, t.id, t.name, t.slug, t.status, u.password_hash, u.full_name,
         u.role, (pa.user_id IS NOT NULL)
  FROM grip.users u
  JOIN grip.tenants t ON t.id = u.tenant_id
  LEFT JOIN grip.platform_admins pa ON pa.user_id = u.id
  WHERE lower(u.email) = lower(p_email)
    AND u.is_active
    AND t.status <> 'cancelled';
$$;

CREATE OR REPLACE FUNCTION grip.resolve_session(p_session_id uuid)
RETURNS TABLE (
  user_id   uuid,
  tenant_id uuid,
  role      grip.user_role,
  full_name text,
  tenant_slug text,
  is_platform_admin boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.tenant_id, u.role, u.full_name, t.slug,
         (pa.user_id IS NOT NULL)
  FROM grip.sessions s
  JOIN grip.users u ON u.id = s.user_id
  JOIN grip.tenants t ON t.id = u.tenant_id
  LEFT JOIN grip.platform_admins pa ON pa.user_id = u.id
  WHERE s.id = p_session_id
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND u.is_active;
$$;

CREATE OR REPLACE FUNCTION grip.create_session(
  p_user_id uuid, p_ttl_days integer, p_user_agent text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO grip.sessions (user_id, tenant_id, expires_at, user_agent)
  SELECT u.id, u.tenant_id, now() + make_interval(days => p_ttl_days), p_user_agent
  FROM grip.users u
  WHERE u.id = p_user_id AND u.is_active
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    RAISE EXCEPTION 'cannot create a session for an unknown or inactive user';
  END IF;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.revoke_session(p_session_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE grip.sessions SET revoked_at = now()
  WHERE id = p_session_id AND revoked_at IS NULL;
$$;

-- These bypass RLS by design, so they must not be callable by the world.
REVOKE ALL ON FUNCTION grip.find_users_for_login(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION grip.resolve_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION grip.create_session(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION grip.revoke_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grip.find_users_for_login(text) TO grip_app;
GRANT EXECUTE ON FUNCTION grip.resolve_session(uuid) TO grip_app;
GRANT EXECUTE ON FUNCTION grip.create_session(uuid, integer, text) TO grip_app;
GRANT EXECUTE ON FUNCTION grip.revoke_session(uuid) TO grip_app;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- `tenants` keys on `id`, not `tenant_id`.
ALTER TABLE grip.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON grip.tenants
  FOR ALL TO grip_app
  USING (grip.tenant_visible(id))
  WITH CHECK (grip.tenant_visible(id));

-- `platform_admins` is the operator's own table: only an operator sees it.
ALTER TABLE grip.platform_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_admins_operator_only ON grip.platform_admins
  FOR ALL TO grip_app
  USING (grip.current_is_platform_admin())
  WITH CHECK (grip.current_is_platform_admin());

-- `part_stock` and `tenant_settings` key on a different primary column but
-- still carry tenant_id, so they ride the standard policy below.

-- Every remaining tenant-owned table gets the identical policy. Writing it in
-- a loop rather than by hand means a table cannot be given a subtly different
-- rule by accident, and adding a table to the list is one line.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'sessions',
    'tax_rates', 'tax_rate_components', 'tenant_settings',
    'employees', 'shifts', 'time_entries',
    'customers', 'vehicles', 'bays', 'appointments',
    'suppliers', 'parts', 'part_stock', 'stock_movements',
    'purchase_orders', 'purchase_order_lines', 'stock_adjustments',
    'work_orders', 'work_order_labour_lines', 'work_order_part_lines',
    'work_order_taxes',
    'counter_sales', 'counter_sale_lines', 'counter_sale_taxes',
    'document_counters', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE grip.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON grip.%I
         FOR ALL TO grip_app
         USING (grip.tenant_visible(tenant_id))
         WITH CHECK (grip.tenant_visible(tenant_id))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA grip TO grip_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA grip TO grip_app;

-- The ledger is append-only. Revoking the grant is cheaper and harder to
-- circumvent than a trigger that raises.
REVOKE ALL ON grip.schema_migrations FROM grip_app;
REVOKE UPDATE, DELETE ON grip.stock_movements FROM grip_app;
REVOKE UPDATE, DELETE ON grip.audit_log FROM grip_app;

-- ---------------------------------------------------------------------------
-- Safety net
-- ---------------------------------------------------------------------------
-- A table added later without RLS would be readable by every tenant. Fail the
-- migration rather than discover that in production.

DO $$
DECLARE
  unguarded text;
BEGIN
  SELECT string_agg(c.relname, ', ')
  INTO unguarded
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'grip'
    AND c.relkind = 'r'
    -- Migration bookkeeping: no tenant data, and grip_app has no grant on it.
    AND c.relname <> 'schema_migrations'
    AND NOT c.relrowsecurity;

  IF unguarded IS NOT NULL THEN
    RAISE EXCEPTION 'tables in schema grip without row-level security: %', unguarded;
  END IF;
END $$;
