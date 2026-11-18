-- Grip — 0023 — scope the platform-admin bypass down to consent, and give the
-- platform console the bulk/aggregate data it actually needs instead.
--
-- Before this migration, grip.tenant_visible() — the single predicate every
-- tenant-owned table's RLS policy used — returned true unconditionally for
-- grip.current_is_platform_admin(). That made "platform admin" a blanket
-- bypass across every shop-data table (customers, work_orders, employees,
-- the lot), not just the operator's own console tables from 0022. Anyone
-- signed in as the operator who opened the ordinary /app pages — the same
-- pages a shop uses — saw every tenant's rows, because those pages trust RLS
-- alone for tenant scoping and never add their own WHERE tenant_id = ...
--
-- This migration:
--   1. Adds a consent record (support_access_grants) a shop can create for
--      its own tenant, time-boxed, to let the operator in to diagnose a
--      problem.
--   2. Introduces grip.shop_data_visible(), which is like tenant_visible()
--      except the platform-admin branch requires an active grant rather than
--      being unconditional, and repoints every shop-owned table at it.
--   3. Leaves grip.tenant_visible() (and the tables that still use it —
--      tenants itself, and the 0022 operator tables: support_requests,
--      payments, security_events, login_attempts, platform_notifications)
--      exactly as it was. Those are the operator's own registry/billing/
--      security data, not a shop's operational data, and are the thing the
--      bulk console is supposed to show.
--   4. Adds grip.platform_shop_stats(), a SECURITY DEFINER aggregate so the
--      console can show per-shop usage (user count, order volume, last
--      activity) without the underlying tables being broadly readable.
--   5. Adds city/province/postal_code to tenants, for jurisdiction tracking
--      (e.g. noticing a shop has moved out of Ontario) — this rides the
--      existing tenants policy, which was never the problem.

-- ---------------------------------------------------------------------------
-- Location, on the registry row every console page already shows in full.
-- ---------------------------------------------------------------------------

ALTER TABLE grip.tenants
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS province text,
  ADD COLUMN IF NOT EXISTS postal_code text;

-- ---------------------------------------------------------------------------
-- Consent record
-- ---------------------------------------------------------------------------

CREATE TABLE grip.support_access_grants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  granted_by_user_id  uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  support_request_id  uuid REFERENCES grip.support_requests(id) ON DELETE SET NULL,
  note                text,
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_access_grants_tenant_idx ON grip.support_access_grants (tenant_id, expires_at DESC);
-- The predicate below runs this on every row check of every shop table, so
-- it has to be fast and it has to be an index, not a sequential scan.
CREATE INDEX support_access_grants_active_idx ON grip.support_access_grants (tenant_id)
  WHERE revoked_at IS NULL;

ALTER TABLE grip.support_access_grants ENABLE ROW LEVEL SECURITY;
-- Metadata only (who/when/why), never shop content — a shop sees its own
-- grant history, the operator sees all of it as part of its own audit trail.
-- All writes go through the two SECURITY DEFINER functions below; grip_app
-- gets no INSERT/UPDATE grant on this table, so there is no path that
-- creates or lifts a grant without going through them.
CREATE POLICY support_access_grants_select ON grip.support_access_grants
  FOR SELECT TO grip_app
  USING (grip.tenant_visible(tenant_id));

GRANT SELECT ON grip.support_access_grants TO grip_app;

-- ---------------------------------------------------------------------------
-- The new predicate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.shop_data_visible(row_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  IF row_tenant_id = grip.current_tenant_id() THEN
    RETURN true;
  END IF;
  IF grip.current_is_platform_admin() THEN
    RETURN EXISTS (
      SELECT 1 FROM grip.support_access_grants g
      WHERE g.tenant_id = row_tenant_id
        AND g.revoked_at IS NULL
        AND g.expires_at > now()
    );
  END IF;
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION grip.shop_data_visible(uuid) TO grip_app;

-- Repoint every shop-owned table from tenant_visible() to shop_data_visible().
-- Same policy-name convention as 0003 (<table>_tenant_isolation) throughout,
-- so this is purely a predicate swap — nothing else about these policies
-- changes. The list is every grip.<table> that ENABLEs row-level security
-- across every migration to date, minus tenants/platform_admins (still
-- tenant_visible — the registry row, not shop content) and the 0022 operator
-- tables (support_requests, login_attempts, security_events, payments,
-- platform_notifications — the operator's own tooling, left untouched) and
-- the new support_access_grants table above (its own, narrower policy).
DO $$
DECLARE t text;
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
    'document_counters', 'audit_log',
    'service_shortcuts', 'service_shortcut_labour', 'service_shortcut_parts',
    'time_off_requests', 'job_time_entries'
  ]
  LOOP
    EXECUTE format('DROP POLICY %I ON grip.%I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON grip.%I
         FOR ALL TO grip_app
         USING (grip.shop_data_visible(tenant_id))
         WITH CHECK (grip.shop_data_visible(tenant_id))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Granting and revoking — callable by a shop for its own tenant, or by the
-- operator to lift a grant early. SECURITY DEFINER because the shop's own
-- role has no write grant on support_access_grants (see above); each
-- function does its own authorization rather than leaning on RLS, since RLS
-- does not apply inside it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.grant_support_access(
  p_hours              integer,
  p_support_request_id uuid DEFAULT NULL,
  p_note               text DEFAULT NULL
)
RETURNS TABLE (id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id  uuid := grip.current_tenant_id();
  v_user_id    uuid := grip.current_user_id();
  v_role       grip.user_role;
  v_shop_name  text;
  v_expires_at timestamptz;
  new_id       uuid;
BEGIN
  IF grip.current_is_platform_admin() THEN
    RAISE EXCEPTION 'only a shop can grant access to its own account' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM grip.users WHERE id = v_user_id;
  IF v_role IS DISTINCT FROM 'shop_admin' THEN
    RAISE EXCEPTION 'only a shop administrator can grant support access' USING ERRCODE = '42501';
  END IF;

  IF p_hours IS NULL OR p_hours < 1 OR p_hours > 168 THEN
    RAISE EXCEPTION 'choose between 1 and 168 hours' USING ERRCODE = 'check_violation';
  END IF;

  IF p_support_request_id IS NOT NULL THEN
    PERFORM 1 FROM grip.support_requests
    WHERE id = p_support_request_id AND tenant_id = v_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'support request not found' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_expires_at := now() + make_interval(hours => p_hours);

  INSERT INTO grip.support_access_grants
    (tenant_id, granted_by_user_id, support_request_id, note, expires_at)
  VALUES (v_tenant_id, v_user_id, p_support_request_id, p_note, v_expires_at)
  RETURNING grip.support_access_grants.id INTO new_id;

  INSERT INTO grip.audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
  VALUES (v_tenant_id, v_user_id, 'support_access.granted', 'support_access_grant', new_id,
          jsonb_build_object('expires_at', v_expires_at, 'hours', p_hours));

  SELECT name INTO v_shop_name FROM grip.tenants WHERE id = v_tenant_id;
  PERFORM grip.notify_platform(
    'security_event'::grip.notification_kind, v_tenant_id,
    coalesce(v_shop_name, 'A shop') || ' granted support access',
    coalesce(v_shop_name, 'A shop') || ' opened its account to GRIP support until ' || v_expires_at || '.',
    NULL, NULL);

  RETURN QUERY SELECT new_id, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION grip.revoke_support_access(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_grant     grip.support_access_grants%ROWTYPE;
  v_role      grip.user_role;
  v_shop_name text;
BEGIN
  SELECT * INTO v_grant FROM grip.support_access_grants WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access grant not found' USING ERRCODE = 'check_violation';
  END IF;

  IF grip.current_is_platform_admin() THEN
    NULL; -- the operator may always end a grant on their own access early
  ELSIF v_grant.tenant_id = grip.current_tenant_id() THEN
    SELECT role INTO v_role FROM grip.users WHERE id = grip.current_user_id();
    IF v_role IS DISTINCT FROM 'shop_admin' THEN
      RAISE EXCEPTION 'only a shop administrator can revoke support access' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'access grant not found' USING ERRCODE = 'check_violation';
  END IF;

  IF v_grant.revoked_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE grip.support_access_grants SET revoked_at = now() WHERE id = p_id;

  INSERT INTO grip.audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
  VALUES (v_grant.tenant_id, grip.current_user_id(), 'support_access.revoked', 'support_access_grant', p_id, NULL);

  SELECT name INTO v_shop_name FROM grip.tenants WHERE id = v_grant.tenant_id;
  PERFORM grip.notify_platform(
    'security_event'::grip.notification_kind, v_grant.tenant_id,
    coalesce(v_shop_name, 'A shop') || ' revoked support access',
    coalesce(v_shop_name, 'A shop') || ' closed GRIP support''s access to its account.',
    NULL, NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION
  grip.grant_support_access(integer, uuid, text),
  grip.revoke_support_access(uuid)
TO grip_app;

-- ---------------------------------------------------------------------------
-- Bulk console stats — the thing the operator actually needs across every
-- shop, without the shop tables themselves being broadly readable. SECURITY
-- DEFINER, and gated by its own check since it runs outside RLS.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.platform_shop_stats()
RETURNS TABLE (
  tenant_id        uuid,
  users            bigint,
  orders           bigint,
  orders_last_30d  bigint,
  last_activity_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT grip.current_is_platform_admin() THEN
    RAISE EXCEPTION 'platform admin only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    (SELECT count(*) FROM grip.users u WHERE u.tenant_id = t.id),
    (SELECT count(*) FROM grip.work_orders w WHERE w.tenant_id = t.id),
    (SELECT count(*) FROM grip.work_orders w
       WHERE w.tenant_id = t.id AND w.created_at > now() - interval '30 days'),
    greatest(
      (SELECT max(u.last_login_at) FROM grip.users u WHERE u.tenant_id = t.id),
      (SELECT max(w.updated_at) FROM grip.work_orders w WHERE w.tenant_id = t.id)
    )
  FROM grip.tenants t;
END;
$$;

GRANT EXECUTE ON FUNCTION grip.platform_shop_stats() TO grip_app;
