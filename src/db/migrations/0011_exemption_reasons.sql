-- Why a document is exempt.
--
-- Charging no HST is a claim the shop has to be able to back up: the CRA can
-- ask, years later, why a given invoice carried no tax. Up to now Grip let you
-- pick "Exempt" and said nothing about why, which left the shop holding a
-- document it couldn't defend.
--
-- So an exemption now carries a reason and, for the kinds that have one, a
-- number — a status card, a government account, a purchaser's HST number. The
-- reason lives on the customer where it is a standing arrangement, and is
-- copied onto each document so the invoice prints what was true when it was
-- issued, exactly as the tax amounts themselves already do.

CREATE TYPE grip.exempt_reason AS ENUM (
  'status_card',   -- Indian status card: point-of-sale relief
  'government',    -- federal or provincial government, or diplomatic
  'resale',        -- sold to another registrant for resale
  'export',        -- delivered outside the province or the country
  'internal',      -- the shop's own vehicle: no sale, so no tax
  'other'
);

-- The kinds that come with a number: the shop should be recording it.
CREATE OR REPLACE FUNCTION grip.exempt_reason_needs_reference(p_reason grip.exempt_reason)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT p_reason IN ('status_card', 'government', 'resale') $$;

ALTER TABLE grip.customers
  ADD COLUMN IF NOT EXISTS exempt_reason     grip.exempt_reason,
  ADD COLUMN IF NOT EXISTS exempt_reference  text,
  ADD COLUMN IF NOT EXISTS exempt_expires_on date;

ALTER TABLE grip.customers
  ADD CONSTRAINT customers_exempt_reference_check CHECK (
    exempt_reason IS NULL
    OR NOT grip.exempt_reason_needs_reference(exempt_reason)
    OR coalesce(trim(exempt_reference), '') <> ''
  );

-- Snapshots. Set while the document is open, frozen with it once issued.
ALTER TABLE grip.work_orders
  ADD COLUMN IF NOT EXISTS exempt_reason    grip.exempt_reason,
  ADD COLUMN IF NOT EXISTS exempt_reference text;

ALTER TABLE grip.work_orders
  ADD CONSTRAINT work_orders_exempt_reference_check CHECK (
    exempt_reason IS NULL
    OR NOT grip.exempt_reason_needs_reference(exempt_reason)
    OR coalesce(trim(exempt_reference), '') <> ''
  );

ALTER TABLE grip.counter_sales
  ADD COLUMN IF NOT EXISTS exempt_reason    grip.exempt_reason,
  ADD COLUMN IF NOT EXISTS exempt_reference text;

ALTER TABLE grip.counter_sales
  ADD CONSTRAINT counter_sales_exempt_reference_check CHECK (
    exempt_reason IS NULL
    OR NOT grip.exempt_reason_needs_reference(exempt_reason)
    OR coalesce(trim(exempt_reference), '') <> ''
  );

-- ---------------------------------------------------------------------------
-- What counts as exempt
-- ---------------------------------------------------------------------------

-- A rate is exempt when it charges nothing by construction: no rate at all, no
-- components, or it applies to neither labour nor parts. An HST rate a shop has
-- set to 0% is NOT exempt — it still applies to labour and parts, and a shop
-- below the registration threshold shouldn't be asked to justify every invoice.
CREATE OR REPLACE FUNCTION grip.rate_is_exempt(p_rate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p_rate_id IS NULL
      OR NOT EXISTS (
           SELECT 1 FROM grip.tax_rates r
           WHERE r.id = p_rate_id
             AND (r.applies_to_labour OR r.applies_to_parts)
             AND EXISTS (SELECT 1 FROM grip.tax_rate_components c WHERE c.tax_rate_id = r.id)
         )
$$;

-- A customer's standing exemption, if it hasn't lapsed. A status card with an
-- expiry date that has passed is no longer proof, so it stops being applied —
-- new work is taxed until someone records the renewal. Erring towards charging
-- tax is the recoverable mistake.
CREATE OR REPLACE FUNCTION grip.customer_exemption_live(p_customer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM grip.customers c
    WHERE c.id = p_customer_id
      AND c.exempt_reason IS NOT NULL
      AND (c.exempt_expires_on IS NULL
           OR c.exempt_expires_on >= (now() AT TIME ZONE grip.shop_timezone())::date)
  )
$$;

-- ---------------------------------------------------------------------------
-- Setting it on a document
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.set_work_order_exemption(
  p_work_order_id uuid,
  p_reason        grip.exempt_reason,
  p_reference     text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wo  grip.work_orders%ROWTYPE;
  v_ref text := nullif(trim(coalesce(p_reference, '')), '');
BEGIN
  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  -- Deliberately the same gate as the tax rate itself, which is looser than
  -- the one on lines: a completed order has not been issued yet, and the
  -- moment you discover a job is exempt is usually as you go to invoice it.
  IF v_wo.status IN ('invoiced', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'the exemption cannot be changed on a work order that is %', v_wo.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_reason IS NOT NULL AND NOT grip.rate_is_exempt(v_wo.tax_rate_id) THEN
    RAISE EXCEPTION 'this work order is being taxed, so it needs no exemption reason'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_reason IS NOT NULL AND grip.exempt_reason_needs_reference(p_reason) AND v_ref IS NULL THEN
    RAISE EXCEPTION 'that exemption needs the card, account or HST number recorded with it'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.work_orders
  SET exempt_reason = p_reason,
      exempt_reference = CASE WHEN p_reason IS NULL THEN NULL ELSE v_ref END
  WHERE id = p_work_order_id;

  PERFORM grip.log_audit('work_order.exemption_set', 'work_order', p_work_order_id,
    jsonb_build_object('reason', p_reason, 'reference', v_ref));
END;
$$;

CREATE OR REPLACE FUNCTION grip.set_counter_sale_exemption(
  p_sale_id   uuid,
  p_reason    grip.exempt_reason,
  p_reference text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sale grip.counter_sales%ROWTYPE;
  v_ref  text := nullif(trim(coalesce(p_reference, '')), '');
BEGIN
  PERFORM grip.assert_counter_sale_open(p_sale_id);
  SELECT * INTO v_sale FROM grip.counter_sales WHERE id = p_sale_id FOR UPDATE;

  IF p_reason IS NOT NULL AND NOT grip.rate_is_exempt(v_sale.tax_rate_id) THEN
    RAISE EXCEPTION 'this sale is being taxed, so it needs no exemption reason'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_reason IS NOT NULL AND grip.exempt_reason_needs_reference(p_reason) AND v_ref IS NULL THEN
    RAISE EXCEPTION 'that exemption needs the card, account or HST number recorded with it'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.counter_sales
  SET exempt_reason = p_reason,
      exempt_reference = CASE WHEN p_reason IS NULL THEN NULL ELSE v_ref END
  WHERE id = p_sale_id;

  PERFORM grip.log_audit('counter_sale.exemption_set', 'counter_sale', p_sale_id,
    jsonb_build_object('reason', p_reason, 'reference', v_ref));
END;
$$;

-- ---------------------------------------------------------------------------
-- Keeping the reason and the rate in step
-- ---------------------------------------------------------------------------

-- Replaces 0005's version: switching a document back onto a taxable rate drops
-- the exemption, so a stale reason can never ride along on a taxed invoice.
CREATE OR REPLACE FUNCTION grip.set_work_order_tax(p_work_order_id uuid, p_tax_rate_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wo   grip.work_orders%ROWTYPE;
  v_rate grip.tax_rates%ROWTYPE;
BEGIN
  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  IF v_wo.status IN ('invoiced', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'tax cannot be changed on a work order that is %', v_wo.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_tax_rate_id IS NOT NULL THEN
    SELECT * INTO v_rate FROM grip.tax_rates WHERE id = p_tax_rate_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'tax rate not found'; END IF;
  END IF;

  UPDATE grip.work_orders SET tax_rate_id = p_tax_rate_id WHERE id = p_work_order_id;

  IF NOT grip.rate_is_exempt(p_tax_rate_id) THEN
    UPDATE grip.work_orders
    SET exempt_reason = NULL, exempt_reference = NULL
    WHERE id = p_work_order_id AND exempt_reason IS NOT NULL;
  END IF;

  PERFORM grip.recalculate_work_order(p_work_order_id);
  PERFORM grip.log_audit('work_order.tax_changed', 'work_order', p_work_order_id,
    jsonb_build_object('from', v_wo.tax_rate_id, 'to', p_tax_rate_id, 'name', v_rate.name));
END;
$$;

CREATE OR REPLACE FUNCTION grip.set_counter_sale_tax(p_sale_id uuid, p_tax_rate_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM grip.assert_counter_sale_open(p_sale_id);
  IF p_tax_rate_id IS NOT NULL THEN
    PERFORM 1 FROM grip.tax_rates WHERE id = p_tax_rate_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'tax rate not found'; END IF;
  END IF;

  UPDATE grip.counter_sales SET tax_rate_id = p_tax_rate_id WHERE id = p_sale_id;

  IF NOT grip.rate_is_exempt(p_tax_rate_id) THEN
    UPDATE grip.counter_sales
    SET exempt_reason = NULL, exempt_reference = NULL
    WHERE id = p_sale_id AND exempt_reason IS NOT NULL;
  END IF;

  PERFORM grip.recalculate_counter_sale(p_sale_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Carrying the customer's standing exemption onto new documents
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.create_work_order(
  p_customer_id uuid,
  p_vehicle_id  uuid,
  p_concern     text,
  p_mileage_in  integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant   uuid := grip.current_tenant_id();
  v_user     uuid := grip.current_user_id();
  v_customer grip.customers%ROWTYPE;
  v_settings grip.tenant_settings%ROWTYPE;
  v_role     grip.user_role;
  v_number   integer;
  v_id       uuid;
  v_live     boolean;
  v_rate     uuid;
BEGIN
  SELECT * INTO v_customer FROM grip.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer not found';
  END IF;

  PERFORM 1 FROM grip.vehicles WHERE id = p_vehicle_id AND customer_id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that vehicle does not belong to this customer';
  END IF;

  IF p_mileage_in IS NOT NULL AND p_mileage_in < 0 THEN
    RAISE EXCEPTION 'mileage cannot be negative' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_settings FROM grip.tenant_settings WHERE tenant_id = v_tenant;
  SELECT role INTO v_role FROM grip.users WHERE id = v_user;

  -- The customer's chosen rate always carries over: if the shop marked them
  -- exempt, the order is exempt. Only the *reason* depends on still being
  -- valid, so a lapsed status card leaves the order exempt but unexplained —
  -- and it cannot then be invoiced until someone records the current proof.
  -- One gate, at the moment the document is issued, rather than a rate that
  -- quietly changes under the shop.
  v_live := grip.customer_exemption_live(p_customer_id);
  v_rate := coalesce(v_customer.tax_rate_id, v_settings.default_tax_rate_id);

  v_number := grip.next_document_number('work_order');

  INSERT INTO grip.work_orders
    (tenant_id, number, customer_id, vehicle_id, status, concern, mileage_in,
     service_advisor_id, opened_by, tax_rate_id, labour_billing_mode,
     exempt_reason, exempt_reference)
  VALUES
    (v_tenant, v_number, p_customer_id, p_vehicle_id, 'quote', nullif(trim(p_concern), ''),
     p_mileage_in,
     CASE WHEN v_role = 'service_advisor' THEN v_user END,
     v_user,
     v_rate,
     coalesce(v_settings.labour_billing_mode, 'flat_rate'),
     CASE WHEN grip.rate_is_exempt(v_rate) AND v_live THEN v_customer.exempt_reason END,
     CASE WHEN grip.rate_is_exempt(v_rate) AND v_live THEN v_customer.exempt_reference END)
  RETURNING id INTO v_id;

  IF p_mileage_in IS NOT NULL THEN
    UPDATE grip.vehicles
    SET current_mileage = greatest(coalesce(current_mileage, 0), p_mileage_in)
    WHERE id = p_vehicle_id;
  END IF;

  PERFORM grip.recalculate_work_order(v_id);
  PERFORM grip.log_audit('work_order.created', 'work_order', v_id,
    jsonb_build_object('number', v_number));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.create_counter_sale(
  p_customer_id   uuid DEFAULT NULL,
  p_customer_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant   uuid := grip.current_tenant_id();
  v_customer grip.customers%ROWTYPE;
  v_settings grip.tenant_settings%ROWTYPE;
  v_number   integer;
  v_id       uuid;
  v_live     boolean := false;
  v_rate     uuid;
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM grip.customers WHERE id = p_customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer not found'; END IF;
    v_live := grip.customer_exemption_live(p_customer_id);
  END IF;

  SELECT * INTO v_settings FROM grip.tenant_settings WHERE tenant_id = v_tenant;
  v_number := grip.next_document_number('counter_sale');
  v_rate := coalesce(v_customer.tax_rate_id, v_settings.default_tax_rate_id);

  INSERT INTO grip.counter_sales
    (tenant_id, number, customer_id, customer_name, status, tax_rate_id, sold_by,
     exempt_reason, exempt_reference)
  VALUES
    (v_tenant, v_number, p_customer_id,
     coalesce(nullif(trim(p_customer_name), ''), v_customer.display_name, 'Walk-in'),
     'open', v_rate, grip.current_user_id(),
     CASE WHEN grip.rate_is_exempt(v_rate) AND v_live THEN v_customer.exempt_reason END,
     CASE WHEN grip.rate_is_exempt(v_rate) AND v_live THEN v_customer.exempt_reference END)
  RETURNING id INTO v_id;

  PERFORM grip.log_audit('counter_sale.created', 'counter_sale', v_id,
    jsonb_build_object('number', v_number));
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- No unexplained exempt invoice leaves the building
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.invoice_work_order(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wo grip.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order % not found in this tenant', p_work_order_id;
  END IF;
  IF v_wo.status <> 'completed' THEN
    RAISE EXCEPTION 'only a completed work order can be invoiced (this one is %)', v_wo.status;
  END IF;

  -- An exempt invoice with nothing to back it up is the one the CRA asks about.
  IF grip.rate_is_exempt(v_wo.tax_rate_id) AND v_wo.exempt_reason IS NULL THEN
    RAISE EXCEPTION 'this invoice charges no HST — record why it is exempt before issuing it'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM grip.recalculate_work_order(p_work_order_id);
  UPDATE grip.work_orders
  SET status = 'invoiced', invoiced_at = now()
  WHERE id = p_work_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.complete_counter_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sale grip.counter_sales%ROWTYPE;
BEGIN
  PERFORM grip.assert_counter_sale_open(p_sale_id);
  PERFORM 1 FROM grip.counter_sale_lines WHERE counter_sale_id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'add at least one part before completing the sale'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_sale FROM grip.counter_sales WHERE id = p_sale_id;
  IF grip.rate_is_exempt(v_sale.tax_rate_id) AND v_sale.exempt_reason IS NULL THEN
    RAISE EXCEPTION 'this sale charges no HST — record why it is exempt before completing it'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM grip.recalculate_counter_sale(p_sale_id);
  UPDATE grip.counter_sales SET status = 'completed', completed_at = now()
  WHERE id = p_sale_id;
  PERFORM grip.log_audit('counter_sale.completed', 'counter_sale', p_sale_id, NULL);
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
