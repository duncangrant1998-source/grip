-- Grip — 0023 — multi-role access and a protected shop owner.
--
-- A shop's role matrix (src/lib/permissions.ts) is a good default, but small
-- shops often want to bend it: a technician who also covers the parts
-- counter, a service advisor who can see parts info. Rather than invent new
-- named roles for every combination, the Staff tab's role picker lets an
-- admin tick any combination of the four roles for a login. One is stored as
-- the "primary" role (what the Role column shows, what the technician
-- billing flag defaults from); the rest are `extra_roles`. `can()` and
-- friends (src/lib/permissions.ts) treat the primary role and every extra
-- role identically — the split is a storage/display detail only.
--
-- Separately: every shop needs exactly one login nobody — not even another
-- admin — can lock themselves out of. `is_shop_owner` marks that one login
-- per tenant; its access can't be touched from this UI by anyone, including
-- itself. The trigger below assigns it automatically to the first shop_admin
-- a tenant ever gets, however that row is inserted (signup, seed, or an
-- admin adding a login) — there is no separate "create a shop" step to hook
-- into yet.

ALTER TABLE grip.users
  ADD COLUMN extra_roles grip.user_role[] NOT NULL DEFAULT '{}';

ALTER TABLE grip.users
  ADD COLUMN is_shop_owner boolean NOT NULL DEFAULT false;

-- At most one owner per tenant.
CREATE UNIQUE INDEX users_one_owner_per_tenant ON grip.users (tenant_id) WHERE is_shop_owner;

-- Backfill: give every tenant that already has active shop admins but no
-- owner yet the earliest-created one. Covers data seeded or created before
-- this migration.
WITH first_admin AS (
  SELECT DISTINCT ON (tenant_id) id, tenant_id
  FROM grip.users
  WHERE role = 'shop_admin' AND is_active
  ORDER BY tenant_id, created_at, id
)
UPDATE grip.users u
SET is_shop_owner = true
FROM first_admin fa
WHERE u.id = fa.id
  AND NOT EXISTS (SELECT 1 FROM grip.users o WHERE o.tenant_id = fa.tenant_id AND o.is_shop_owner);

CREATE OR REPLACE FUNCTION grip.assign_shop_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.role = 'shop_admin' AND NOT EXISTS (
    SELECT 1 FROM grip.users WHERE tenant_id = NEW.tenant_id AND is_shop_owner
  ) THEN
    NEW.is_shop_owner := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_assign_shop_owner ON grip.users;
CREATE TRIGGER users_assign_shop_owner
BEFORE INSERT ON grip.users
FOR EACH ROW EXECUTE FUNCTION grip.assign_shop_owner();

-- resolve_session now also returns the role grant and the owner flag so the
-- app can fold both into the session on every request — revoking a grant (or
-- the owner protection kicking in) takes effect immediately, same as a role
-- change.
DROP FUNCTION grip.resolve_session(uuid);

CREATE FUNCTION grip.resolve_session(p_session_id uuid)
RETURNS TABLE (
  user_id           uuid,
  tenant_id         uuid,
  role              grip.user_role,
  full_name         text,
  tenant_slug       text,
  is_platform_admin boolean,
  extra_roles       grip.user_role[],
  is_shop_owner     boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.tenant_id, u.role, u.full_name, t.slug,
         (pa.user_id IS NOT NULL), u.extra_roles, u.is_shop_owner
  FROM grip.sessions s
  JOIN grip.users u ON u.id = s.user_id
  JOIN grip.tenants t ON t.id = u.tenant_id
  LEFT JOIN grip.platform_admins pa ON pa.user_id = u.id
  WHERE s.id = p_session_id
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND u.is_active;
$$;

-- This bypasses RLS by design (same as the rest of the pre-auth/session
-- functions in 0003), so it must not be callable by the world.
REVOKE ALL ON FUNCTION grip.resolve_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grip.resolve_session(uuid) TO grip_app;

-- update_user_access grows a fourth argument — the extra roles ticked
-- alongside the primary one — and now refuses outright to touch the shop's
-- owner. Same admin-only guard rails as before otherwise: only an active
-- shop_admin can get here, and a shop must always keep at least one active
-- administrator.
DROP FUNCTION grip.update_user_access(uuid, grip.user_role, boolean);

CREATE FUNCTION grip.update_user_access(
  p_user_id     uuid,
  p_role        grip.user_role,
  p_is_active   boolean,
  p_extra_roles grip.user_role[] DEFAULT '{}'
)
RETURNS TABLE (notify_title text, notify_body text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user grip.users%ROWTYPE;
  v_name text;
  v_title text;
  v_body  text;
  v_extra_roles grip.user_role[];
BEGIN
  PERFORM 1 FROM grip.users
  WHERE tenant_id = grip.current_tenant_id() AND role = 'shop_admin' AND is_active
  ORDER BY id FOR UPDATE;

  SELECT * INTO v_user FROM grip.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'login not found'; END IF;

  IF v_user.is_shop_owner THEN
    RAISE EXCEPTION 'the shop owner always keeps full access — this can''t be changed, even by another administrator'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_user.role = 'shop_admin' AND v_user.is_active
     AND (p_role <> 'shop_admin' OR NOT p_is_active) THEN
    PERFORM 1 FROM grip.users
    WHERE tenant_id = v_user.tenant_id AND role = 'shop_admin' AND is_active AND id <> p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'a shop must keep at least one active administrator'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- De-duplicate, and never let the primary role repeat as an extra.
  SELECT coalesce(array_agg(DISTINCT r), '{}') INTO v_extra_roles
  FROM unnest(p_extra_roles) AS r
  WHERE r <> p_role;

  UPDATE grip.users
  SET role = p_role, is_active = p_is_active, extra_roles = v_extra_roles
  WHERE id = p_user_id;

  IF NOT p_is_active THEN
    UPDATE grip.sessions SET revoked_at = now() WHERE user_id = p_user_id AND revoked_at IS NULL;
  END IF;
  IF p_role = 'technician' THEN
    UPDATE grip.employees SET is_technician = true WHERE user_id = p_user_id;
  END IF;

  PERFORM grip.log_audit('user.access_changed', 'user', p_user_id,
    jsonb_build_object('role_from', v_user.role, 'role_to', p_role,
                       'active_from', v_user.is_active, 'active_to', p_is_active,
                       'extra_roles_from', v_user.extra_roles,
                       'extra_roles_to', v_extra_roles));

  IF p_role = 'shop_admin' AND v_user.role <> 'shop_admin' THEN
    SELECT full_name INTO v_name FROM grip.users WHERE id = p_user_id;
    v_title := 'New shop admin: ' || coalesce(v_name, 'a staff member');
    v_body  := coalesce(v_name, 'A staff member') || ' was promoted from ' || v_user.role || ' to shop_admin.';
    PERFORM grip.log_security_event(
      'privilege_grant'::grip.security_event_kind, v_user.tenant_id, p_user_id,
      jsonb_build_object('role_from', v_user.role, 'role_to', p_role),
      v_title, v_body);
  END IF;

  RETURN QUERY SELECT v_title, v_body;
END;
$$;

-- remove_employee gets the same owner guard: the shop's one permanent admin
-- can't be removed from staff by anyone (they already can't remove
-- themselves — see the v_emp.user_id = v_me check below — this closes the
-- gap for every *other* admin too). Everything else below is unchanged from
-- 0017's version of this function.
CREATE OR REPLACE FUNCTION grip.remove_employee(p_employee_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_me         uuid := grip.current_user_id();
  v_emp        grip.employees%ROWTYPE;
  v_user       grip.users%ROWTYPE;
  v_clocked    integer := 0;
  v_shifts     integer := 0;
  v_unassigned integer := 0;
  v_requests   integer := 0;
BEGIN
  -- Same lock order as update_user_access, so two administrators removing each
  -- other cannot both succeed and leave the shop with none.
  PERFORM 1 FROM grip.users
  WHERE tenant_id = grip.current_tenant_id() AND role = 'shop_admin' AND is_active
  ORDER BY id FOR UPDATE;

  SELECT * INTO v_emp FROM grip.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff member not found'; END IF;
  IF v_emp.removed_at IS NOT NULL THEN
    RAISE EXCEPTION '% has already been removed', v_emp.full_name USING ERRCODE = 'check_violation';
  END IF;

  IF v_emp.user_id IS NOT NULL THEN
    SELECT * INTO v_user FROM grip.users WHERE id = v_emp.user_id FOR UPDATE;

    IF v_emp.user_id = v_me THEN
      RAISE EXCEPTION 'you cannot remove yourself' USING ERRCODE = 'check_violation';
    END IF;

    IF v_user.is_shop_owner THEN
      RAISE EXCEPTION 'the shop owner can''t be removed from staff' USING ERRCODE = 'check_violation';
    END IF;

    IF v_user.role = 'shop_admin' AND v_user.is_active THEN
      PERFORM 1 FROM grip.users
      WHERE tenant_id = v_user.tenant_id AND role = 'shop_admin' AND is_active AND id <> v_user.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'a shop must keep at least one active administrator'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- If they are on the clock, close it now: otherwise it would run for ever.
  UPDATE grip.time_entries
  SET clock_out = now(), note = trim(concat_ws(' · ', note, 'closed when removed from staff'))
  WHERE employee_id = p_employee_id AND clock_out IS NULL;
  GET DIAGNOSTICS v_clocked = ROW_COUNT;

  -- Shifts that have not started are no longer anyone's; the ones already worked stay.
  DELETE FROM grip.shifts WHERE employee_id = p_employee_id AND starts_at > now();
  GET DIAGNOSTICS v_shifts = ROW_COUNT;

  -- A booking should not keep a technician who has gone. It is left unassigned,
  -- for the service desk to give to someone else.
  UPDATE grip.appointments
  SET assigned_tech_id = NULL
  WHERE assigned_tech_id = p_employee_id
    AND status IN ('scheduled', 'confirmed', 'arrived') AND starts_at > now();
  GET DIAGNOSTICS v_unassigned = ROW_COUNT;

  -- Their own pending requests are withdrawn; ones addressed to them go to the administrators.
  UPDATE grip.time_off_requests SET status = 'cancelled'
  WHERE employee_id = p_employee_id AND status = 'pending';
  GET DIAGNOSTICS v_requests = ROW_COUNT;
  IF v_emp.user_id IS NOT NULL THEN
    UPDATE grip.time_off_requests SET recipient_user_id = NULL
    WHERE recipient_user_id = v_emp.user_id AND status = 'pending';
  END IF;

  -- Close the login: no way back in, sessions ended, the email free to be used again.
  IF v_emp.user_id IS NOT NULL THEN
    UPDATE grip.sessions SET revoked_at = now() WHERE user_id = v_emp.user_id AND revoked_at IS NULL;
    UPDATE grip.users
    SET is_active = false,
        password_hash = '!removed',
        email = 'removed+' || id::text || '@removed.invalid',
        updated_at = now()
    WHERE id = v_emp.user_id;
  END IF;

  UPDATE grip.employees
  SET is_active = false, removed_at = now(), removed_by = v_me,
      removal_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  WHERE id = p_employee_id;

  PERFORM grip.log_audit('staff.removed', 'employee', p_employee_id,
    jsonb_build_object('name', v_emp.full_name, 'email', v_user.email, 'role', v_user.role,
                       'clocked_out', v_clocked, 'shifts_removed', v_shifts,
                       'appointments_unassigned', v_unassigned));

  RETURN jsonb_build_object('shifts_removed', v_shifts, 'appointments_unassigned', v_unassigned,
                            'clocked_out', v_clocked, 'requests_withdrawn', v_requests);
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
