-- Grip — 0022 — platform-admin console: support requests, security events,
-- manual payment tracking, and the notification feed that ties them together.
--
-- Everything here is the SaaS operator's own tooling, not shop data, so most
-- of it is visible only to a platform admin (grip.current_is_platform_admin()),
-- the same predicate `platform_admins` itself uses in 0003. The one exception
-- is `support_requests`: a shop can see and create its own, but only a
-- platform admin can change its status — a shop cannot mark its own ticket
-- resolved.
--
-- Notifications are written by a single SECURITY DEFINER function,
-- grip.notify_platform(), so a tenant user filing a support request can make
-- a row appear in a table they otherwise cannot write to. Email delivery
-- itself happens in the application layer (Postgres cannot make HTTP calls);
-- these tables are the durable, in-app record regardless of whether an email
-- goes out.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE grip.support_request_status AS ENUM ('open', 'in_progress', 'resolved');
CREATE TYPE grip.security_event_kind AS ENUM ('failed_logins', 'privilege_grant');
CREATE TYPE grip.payment_status AS ENUM ('paid', 'due', 'overdue', 'waived');
CREATE TYPE grip.notification_kind AS ENUM ('support_request', 'security_event');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE grip.support_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  subject            text NOT NULL CHECK (length(trim(subject)) > 0),
  message            text NOT NULL CHECK (length(trim(message)) > 0),
  status             grip.support_request_status NOT NULL DEFAULT 'open',
  resolved_at        timestamptz,
  resolved_by_user_id uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_requests_tenant_idx ON grip.support_requests (tenant_id, created_at DESC);
CREATE INDEX support_requests_status_idx ON grip.support_requests (status, created_at DESC);

-- Not tenant-owned in the usual sense: a tenant never reads another tenant's
-- row here, but tenant_id is nullable (an attempt against an unknown email
-- matches no tenant at all) so it cannot ride the standard tenant policy.
CREATE TABLE grip.login_attempts (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  tenant_id  uuid REFERENCES grip.tenants(id) ON DELETE CASCADE,
  succeeded  boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_created_idx ON grip.login_attempts (lower(email), created_at DESC);

-- Platform-only. Not keyed to a single tenant_id column the usual way because
-- a privilege grant is about a user, and a failed-login spike may name no
-- tenant at all (an email that matches nothing).
CREATE TABLE grip.security_events (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid REFERENCES grip.tenants(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  kind       grip.security_event_kind NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_created_idx ON grip.security_events (created_at DESC);

-- Manual payment tracking, ahead of Stripe (docs/DESIGN.md §8, not wired yet).
-- Deliberately plain so it can sit alongside a future stripe_customer_id /
-- stripe_subscription_id on tenants without anything here needing to change —
-- a Stripe webhook would simply start writing rows the same shape as a manual
-- one, with a stripe_invoice_id added when that day comes.
CREATE TABLE grip.payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  amount              numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency            text NOT NULL DEFAULT 'CAD',
  period_start        date,
  period_end          date,
  due_date            date,
  status              grip.payment_status NOT NULL DEFAULT 'due',
  paid_at             timestamptz,
  note                text,
  created_by_user_id  uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_tenant_idx ON grip.payments (tenant_id, due_date DESC);
CREATE INDEX payments_status_idx ON grip.payments (status);

-- The single feed the console's notification bell reads. Each row optionally
-- points back at the support request or security event that caused it, but
-- carries its own title/body so the bell never needs a join to render.
CREATE TABLE grip.platform_notifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               grip.notification_kind NOT NULL,
  tenant_id          uuid REFERENCES grip.tenants(id) ON DELETE CASCADE,
  title              text NOT NULL,
  body               text NOT NULL,
  support_request_id uuid REFERENCES grip.support_requests(id) ON DELETE CASCADE,
  security_event_id  bigint REFERENCES grip.security_events(id) ON DELETE CASCADE,
  is_read            boolean NOT NULL DEFAULT false,
  read_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_notifications_unread_idx ON grip.platform_notifications (is_read, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_requests', 'payments']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_touch_updated_at BEFORE UPDATE ON grip.%I
         FOR EACH ROW EXECUTE FUNCTION grip.touch_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE grip.support_requests ENABLE ROW LEVEL SECURITY;
-- A shop sees and files its own tickets; a platform admin sees every shop's.
CREATE POLICY support_requests_select ON grip.support_requests
  FOR SELECT TO grip_app
  USING (grip.tenant_visible(tenant_id));
CREATE POLICY support_requests_insert ON grip.support_requests
  FOR INSERT TO grip_app
  WITH CHECK (tenant_id = grip.current_tenant_id());
-- Only the operator resolves a ticket — a shop cannot close its own.
CREATE POLICY support_requests_update ON grip.support_requests
  FOR UPDATE TO grip_app
  USING (grip.current_is_platform_admin())
  WITH CHECK (grip.current_is_platform_admin());

ALTER TABLE grip.login_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY login_attempts_platform_only ON grip.login_attempts
  FOR ALL TO grip_app
  USING (grip.current_is_platform_admin())
  WITH CHECK (grip.current_is_platform_admin());

ALTER TABLE grip.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_events_platform_only ON grip.security_events
  FOR ALL TO grip_app
  USING (grip.current_is_platform_admin())
  WITH CHECK (grip.current_is_platform_admin());

ALTER TABLE grip.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_platform_only ON grip.payments
  FOR ALL TO grip_app
  USING (grip.current_is_platform_admin())
  WITH CHECK (grip.current_is_platform_admin());

ALTER TABLE grip.platform_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_notifications_platform_only ON grip.platform_notifications
  FOR ALL TO grip_app
  USING (grip.current_is_platform_admin())
  WITH CHECK (grip.current_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  grip.support_requests, grip.login_attempts, grip.security_events,
  grip.payments, grip.platform_notifications
TO grip_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA grip TO grip_app;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- The only way a row lands in platform_notifications. SECURITY DEFINER so a
-- tenant user filing a support request (which the row-owning policy above
-- restricts to platform admins) can still make the operator's bell ring.
CREATE OR REPLACE FUNCTION grip.notify_platform(
  p_kind               grip.notification_kind,
  p_tenant_id          uuid,
  p_title              text,
  p_body               text,
  p_support_request_id uuid    DEFAULT NULL,
  p_security_event_id  bigint  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO grip.platform_notifications
    (kind, tenant_id, title, body, support_request_id, security_event_id)
  VALUES (p_kind, p_tenant_id, p_title, p_body, p_support_request_id, p_security_event_id)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- A shop files a support request. Returns the new request id; the caller
-- (the server action) uses that only to confirm success — the notification
-- itself, and any email it triggers, do not depend on the caller doing
-- anything further for the in-app record to exist.
CREATE OR REPLACE FUNCTION grip.create_support_request(p_subject text, p_message text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid := grip.current_tenant_id();
  v_user_id   uuid := grip.current_user_id();
  v_shop_name text;
  new_id      uuid;
BEGIN
  IF length(trim(p_subject)) = 0 THEN
    RAISE EXCEPTION 'enter a subject' USING ERRCODE = 'check_violation';
  END IF;
  IF length(trim(p_message)) = 0 THEN
    RAISE EXCEPTION 'enter a message' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO grip.support_requests (tenant_id, created_by_user_id, subject, message)
  VALUES (v_tenant_id, v_user_id, trim(p_subject), trim(p_message))
  RETURNING id INTO new_id;

  SELECT name INTO v_shop_name FROM grip.tenants WHERE id = v_tenant_id;

  PERFORM grip.notify_platform(
    'support_request'::grip.notification_kind, v_tenant_id,
    coalesce(v_shop_name, 'A shop') || ' — ' || trim(p_subject),
    trim(p_message),
    new_id, NULL);

  RETURN new_id;
END;
$$;

-- A platform admin resolves (or reopens) a ticket.
CREATE OR REPLACE FUNCTION grip.set_support_request_status(
  p_id uuid, p_status grip.support_request_status
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT grip.current_is_platform_admin() THEN
    RAISE EXCEPTION 'only the operator can change a ticket''s status' USING ERRCODE = '42501';
  END IF;
  UPDATE grip.support_requests
  SET status = p_status,
      resolved_at = CASE WHEN p_status = 'resolved' THEN now() ELSE NULL END,
      resolved_by_user_id = CASE WHEN p_status = 'resolved' THEN grip.current_user_id() ELSE NULL END
  WHERE id = p_id;
END;
$$;

-- Records one login attempt and returns how many *consecutive* failures this
-- email has racked up since its last success (0 for a success, or for the
-- very first attempt). Pre-authentication, so this runs outside any tenant
-- context — SECURITY DEFINER lets it write regardless.
CREATE OR REPLACE FUNCTION grip.record_login_attempt(
  p_email text, p_tenant_id uuid, p_succeeded boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_since   timestamptz;
  v_count   integer;
BEGIN
  INSERT INTO grip.login_attempts (email, tenant_id, succeeded)
  VALUES (lower(trim(p_email)), p_tenant_id, p_succeeded);

  IF p_succeeded THEN
    RETURN 0;
  END IF;

  SELECT max(created_at) INTO v_since
  FROM grip.login_attempts
  WHERE lower(email) = lower(trim(p_email)) AND succeeded;

  SELECT count(*) INTO v_count
  FROM grip.login_attempts
  WHERE lower(email) = lower(trim(p_email))
    AND NOT succeeded
    AND created_at > now() - interval '15 minutes'
    AND (v_since IS NULL OR created_at > v_since);

  RETURN v_count;
END;
$$;

-- Writes a security_events row and the notification it triggers. Called from
-- application code once it decides a threshold was crossed, and from
-- grip.update_user_access (below) on a promotion to shop_admin.
CREATE OR REPLACE FUNCTION grip.log_security_event(
  p_kind      grip.security_event_kind,
  p_tenant_id uuid,
  p_user_id   uuid,
  p_details   jsonb,
  p_title     text,
  p_body      text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE new_id bigint;
BEGIN
  INSERT INTO grip.security_events (tenant_id, user_id, kind, details)
  VALUES (p_tenant_id, p_user_id, p_kind, p_details)
  RETURNING id INTO new_id;

  PERFORM grip.notify_platform(
    'security_event'::grip.notification_kind, p_tenant_id, p_title, p_body, NULL, new_id);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.mark_notification_read(p_id uuid, p_read boolean DEFAULT true)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  UPDATE grip.platform_notifications
  SET is_read = p_read, read_at = CASE WHEN p_read THEN now() ELSE NULL END
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION grip.mark_all_notifications_read()
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  UPDATE grip.platform_notifications SET is_read = true, read_at = now() WHERE NOT is_read;
$$;

-- ---------------------------------------------------------------------------
-- A promotion to shop_admin is a security event, whoever triggers it. This
-- redefines the 0008 function rather than editing 0008, so the history of
-- what each migration did stays honest.
-- ---------------------------------------------------------------------------

-- Returns the title/body of the security-event notification it just raised,
-- or two nulls when the change was not a promotion — so the caller (the
-- server action) knows whether to send the operator an email, without a
-- second query to work out what changed.
--
-- Postgres won't let CREATE OR REPLACE change a function's return type
-- (0008 defined this as RETURNS void), so the old signature has to go first.
DROP FUNCTION grip.update_user_access(uuid, grip.user_role, boolean);

CREATE OR REPLACE FUNCTION grip.update_user_access(
  p_user_id   uuid,
  p_role      grip.user_role,
  p_is_active boolean
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
BEGIN
  PERFORM 1 FROM grip.users
  WHERE tenant_id = grip.current_tenant_id() AND role = 'shop_admin' AND is_active
  ORDER BY id FOR UPDATE;

  SELECT * INTO v_user FROM grip.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'login not found'; END IF;

  IF v_user.role = 'shop_admin' AND v_user.is_active
     AND (p_role <> 'shop_admin' OR NOT p_is_active) THEN
    PERFORM 1 FROM grip.users
    WHERE tenant_id = v_user.tenant_id AND role = 'shop_admin' AND is_active AND id <> p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'a shop must keep at least one active administrator'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE grip.users SET role = p_role, is_active = p_is_active WHERE id = p_user_id;

  IF NOT p_is_active THEN
    UPDATE grip.sessions SET revoked_at = now() WHERE user_id = p_user_id AND revoked_at IS NULL;
  END IF;
  IF p_role = 'technician' THEN
    UPDATE grip.employees SET is_technician = true WHERE user_id = p_user_id;
  END IF;

  PERFORM grip.log_audit('user.access_changed', 'user', p_user_id,
    jsonb_build_object('role_from', v_user.role, 'role_to', p_role,
                       'active_from', v_user.is_active, 'active_to', p_is_active));

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

-- A row appearing here at all is deliberately rare (see 0002's comment on the
-- table) and happens outside the app's own role-management UI, so it is
-- caught with a trigger rather than relying on every future call site to
-- remember to log it.
CREATE OR REPLACE FUNCTION grip.log_platform_admin_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_name text; v_tenant_id uuid;
BEGIN
  SELECT full_name, tenant_id INTO v_name, v_tenant_id FROM grip.users WHERE id = NEW.user_id;
  PERFORM grip.log_security_event(
    'privilege_grant'::grip.security_event_kind, v_tenant_id, NEW.user_id,
    jsonb_build_object('granted', 'platform_admin', 'note', NEW.note),
    'New platform admin: ' || coalesce(v_name, 'someone'),
    coalesce(v_name, 'Someone') || ' was granted platform-admin access.');
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_admins_log_grant
  AFTER INSERT ON grip.platform_admins
  FOR EACH ROW EXECUTE FUNCTION grip.log_platform_admin_grant();

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
