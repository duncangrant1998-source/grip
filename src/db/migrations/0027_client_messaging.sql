-- Grip — 0027 — client email/SMS messaging, as a per-shop add-on.
--
-- Two things, deliberately kept separate from 0026's intershop messaging:
--
--   grip.shop_addons    — whether a shop has this turned on at all. A shop
--     can only ever request it (status stays 'requested'); only the
--     platform console can move it to 'active' (or back to 'suspended').
--     That split is enforced in RLS's WITH CHECK below, not just in the UI —
--     a tenant session writing straight to the table cannot self-grant.
--     Billing for this add-on is out of scope here on purpose: Duncan wants
--     the functionality wired up now and the payable side (a real Resend/
--     Twilio relationship, pricing) set up later, per shop, once a shop asks
--     for it. grip.send_client_message below works whether or not a
--     provider is actually configured — see src/lib/client-notify.ts.
--
--   grip.client_messages — the actual email/SMS sent (or attempted) to a
--     customer, always tied to one work order. Scoped to *open* work orders
--     only (approved / in_progress / completed — the same "open" bucket the
--     orders list already uses), not quotes or closed orders: the point is
--     telling a customer about work actually under way, not general-purpose
--     marketing.

CREATE TYPE grip.addon_key AS ENUM ('client_messaging');
CREATE TYPE grip.addon_status AS ENUM ('requested', 'active', 'suspended');
CREATE TYPE grip.message_channel AS ENUM ('email', 'sms');
CREATE TYPE grip.client_message_status AS ENUM ('queued', 'sent', 'failed');

CREATE TABLE grip.shop_addons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  addon_key     grip.addon_key NOT NULL,
  status        grip.addon_status NOT NULL DEFAULT 'requested',
  requested_by  uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  requested_at  timestamptz,
  granted_by    uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  granted_at    timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shop_addons_tenant_key_key ON grip.shop_addons (tenant_id, addon_key);
CREATE TRIGGER shop_addons_touch_updated_at BEFORE UPDATE ON grip.shop_addons
  FOR EACH ROW EXECUTE FUNCTION grip.touch_updated_at();

CREATE TABLE grip.client_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES grip.work_orders(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES grip.customers(id) ON DELETE CASCADE,
  channel       grip.message_channel NOT NULL,
  to_address    text NOT NULL,
  body          text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 1600),
  status        grip.client_message_status NOT NULL DEFAULT 'queued',
  failure_reason text,
  sent_by       uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_messages_wo_idx ON grip.client_messages (work_order_id, created_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE grip.shop_addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY shop_addons_tenant_isolation ON grip.shop_addons
  FOR ALL TO grip_app
  USING (grip.tenant_visible(tenant_id))
  WITH CHECK (
    grip.tenant_visible(tenant_id)
    -- A shop can write its own row, but only to ask ('requested'). Flipping
    -- to 'active' or 'suspended' is the platform console's call alone.
    AND (grip.current_is_platform_admin() OR status = 'requested')
  );
GRANT SELECT, INSERT, UPDATE ON grip.shop_addons TO grip_app;

ALTER TABLE grip.client_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_messages_tenant_isolation ON grip.client_messages
  FOR ALL TO grip_app
  USING (grip.tenant_visible(tenant_id))
  WITH CHECK (grip.tenant_visible(tenant_id));
GRANT SELECT, INSERT, UPDATE ON grip.client_messages TO grip_app;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- A shop asking for the add-on. Idempotent: re-requesting after being
-- suspended puts it back in the queue rather than erroring.
CREATE OR REPLACE FUNCTION grip.request_addon(p_addon_key grip.addon_key, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO grip.shop_addons (tenant_id, addon_key, status, requested_by, requested_at, note)
  VALUES (grip.current_tenant_id(), p_addon_key, 'requested', grip.current_user_id(), now(), p_note)
  ON CONFLICT (tenant_id, addon_key) DO UPDATE SET
    status = 'requested',
    requested_by = grip.current_user_id(),
    requested_at = now(),
    note = coalesce(EXCLUDED.note, grip.shop_addons.note);
END;
$$;

-- Not SECURITY DEFINER — runs as grip_app, so RLS (including the "who may
-- write client_messages" boundary, which here is just the ordinary tenant
-- policy) applies exactly as it would to a hand-written query. Which roles
-- may call this at all is an application-layer permission
-- (clientMessaging.send in permissions.ts), same split as everywhere else.
CREATE OR REPLACE FUNCTION grip.send_client_message(
  p_work_order_id uuid,
  p_channel       grip.message_channel,
  p_body          text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant   uuid := grip.current_tenant_id();
  v_sender   uuid := grip.current_user_id();
  v_wo       grip.work_orders%ROWTYPE;
  v_customer grip.customers%ROWTYPE;
  v_to       text;
  v_body     text := trim(coalesce(p_body, ''));
  v_id       uuid;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'no signed-in user' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_body) = 0 THEN
    RAISE EXCEPTION 'Write something before sending.' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_body) > 1600 THEN
    RAISE EXCEPTION 'That message is too long.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM grip.shop_addons
  WHERE tenant_id = v_tenant AND addon_key = 'client_messaging' AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client email/text messaging isn''t turned on for this shop yet.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order not found' USING ERRCODE = 'P0001';
  END IF;
  IF v_wo.status NOT IN ('approved', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'Client messaging is only available while a work order is open.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_customer FROM grip.customers WHERE id = v_wo.customer_id;

  IF p_channel = 'email' THEN
    v_to := v_customer.email;
    IF v_to IS NULL OR length(trim(v_to)) = 0 THEN
      RAISE EXCEPTION 'This customer has no email on file.' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_to := v_customer.phone;
    IF v_to IS NULL OR length(trim(v_to)) = 0 THEN
      RAISE EXCEPTION 'This customer has no phone number on file.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO grip.client_messages
    (tenant_id, work_order_id, customer_id, channel, to_address, body, sent_by)
  VALUES (v_tenant, p_work_order_id, v_wo.customer_id, p_channel, trim(v_to), v_body, v_sender)
  RETURNING id INTO v_id;

  PERFORM grip.log_audit('client_message.queued', 'work_order', p_work_order_id,
    jsonb_build_object('channel', p_channel, 'message_id', v_id));

  RETURN v_id;
END;
$$;

-- Flips a queued row to its outcome once the app layer has actually tried
-- the provider (or found none configured). Kept separate from the insert
-- above so the validation above never depends on network I/O.
CREATE OR REPLACE FUNCTION grip.set_client_message_outcome(
  p_id uuid, p_status grip.client_message_status, p_failure_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  UPDATE grip.client_messages
  SET status = p_status, failure_reason = p_failure_reason
  WHERE id = p_id;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
