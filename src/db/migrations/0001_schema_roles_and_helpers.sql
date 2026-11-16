-- Grip — 0001 — schema, restricted application role, tenancy helper functions.
--
-- Everything Grip owns lives in the `grip` schema. The application connects as
-- `grip_app`, which has NOBYPASSRLS and owns nothing, so row-level security is
-- not something application code can forget or work around.

CREATE SCHEMA IF NOT EXISTS grip;

-- ---------------------------------------------------------------------------
-- The restricted application role.
-- ---------------------------------------------------------------------------
-- NOBYPASSRLS is the whole point: even a crafted query cannot see past a
-- policy. NOCREATEDB/NOCREATEROLE/NOSUPERUSER keep the blast radius small if
-- the connection string ever leaks.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grip_app') THEN
    CREATE ROLE grip_app LOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE grip_app NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA grip TO grip_app;

-- No blanket table grants here. 0002 grants per table as it creates them, so a
-- table added later without a policy is unreachable rather than wide open.

-- ---------------------------------------------------------------------------
-- Tenancy helpers.
-- ---------------------------------------------------------------------------
-- These read transaction-local settings written by withTenant() in
-- src/db/client.ts. `SET LOCAL` means they expire with the transaction and
-- cannot leak to the next borrower of a pooled connection.

-- Raises rather than returning NULL. An unscoped query is a bug, and a bug
-- that errors loudly is worth ten that quietly return the empty set.
CREATE OR REPLACE FUNCTION grip.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  raw text;
BEGIN
  raw := current_setting('app.tenant_id', true);
  IF raw IS NULL OR raw = '' THEN
    RAISE EXCEPTION
      'app.tenant_id is not set: tenant data was queried outside a tenant-scoped transaction'
      USING ERRCODE = '42501';
  END IF;
  RETURN raw::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION grip.current_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  raw text;
BEGIN
  raw := current_setting('app.user_id', true);
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
END;
$$;

-- Never raises: it is consulted before current_tenant_id() and must be able to
-- answer on a connection that has no tenant chosen.
CREATE OR REPLACE FUNCTION grip.current_is_platform_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN coalesce(current_setting('app.is_platform_admin', true), 'false') = 'true';
END;
$$;

-- The single predicate every tenant policy uses.
--
-- Written as one function on purpose. The obvious spelling,
--   USING (grip.current_is_platform_admin() OR tenant_id = grip.current_tenant_id())
-- relies on SQL short-circuiting OR, which Postgres does not guarantee — the
-- planner may evaluate current_tenant_id() first and raise for a legitimate
-- platform-admin query. An explicit IF removes the ambiguity.
CREATE OR REPLACE FUNCTION grip.tenant_visible(row_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF grip.current_is_platform_admin() THEN
    RETURN true;
  END IF;
  RETURN row_tenant_id = grip.current_tenant_id();
END;
$$;

GRANT EXECUTE ON FUNCTION
  grip.current_tenant_id(),
  grip.current_user_id(),
  grip.current_is_platform_admin(),
  grip.tenant_visible(uuid)
TO grip_app;

-- Keep updated_at honest without every query remembering to set it.
CREATE OR REPLACE FUNCTION grip.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
