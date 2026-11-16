-- A work order you can simply type into.
--
-- Until now a labour line was edited by opening it, changing it and pressing
-- Save, billing mode and tax could only be set when the line was created, the
-- order's customer could not be changed once it existed, and there was nowhere
-- to write something for the customer. This migration gives all of that a home.
--
--   * every line remembers who last changed it, so the page can say "Edited by"
--   * labour can be edited, added to and removed from a COMPLETED order too
--     (before it is invoiced) — hours are routinely corrected at completion
--   * the whole line is editable: description, hours, actual hours, rate, billing
--     mode, tax and technician
--   * the order has notes, written by the advisor for the customer
--   * the order can be moved to another customer and vehicle, and its concern and
--     mileage corrected, without starting over

ALTER TABLE grip.work_order_labour_lines
  ADD COLUMN IF NOT EXISTS edited_by_user_id uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at         timestamptz;

ALTER TABLE grip.work_order_part_lines
  ADD COLUMN IF NOT EXISTS edited_by_user_id uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at         timestamptz;

ALTER TABLE grip.work_orders
  ADD COLUMN IF NOT EXISTS notes text;

-- ---------------------------------------------------------------------------
-- Which statuses may still change labour
-- ---------------------------------------------------------------------------

-- Parts stop at "completed" because completing consumes them. Labour has no such
-- side effect, and hours really do get corrected when the job is closed out, so
-- it stays editable until the order is invoiced.
CREATE OR REPLACE FUNCTION grip.assert_work_order_labour_editable(p_status grip.work_order_status)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_status NOT IN ('quote', 'approved', 'in_progress', 'completed') THEN
    RAISE EXCEPTION 'cannot change labour on a work order that is %', p_status
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Labour: add, edit, remove
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.add_labour_line(
  p_work_order_id uuid,
  p_description   text,
  p_hours         numeric,
  p_actual_hours  numeric DEFAULT NULL,
  p_rate          numeric DEFAULT NULL,
  p_mode          grip.labour_billing_mode DEFAULT NULL,
  p_tech_id       uuid DEFAULT NULL,
  p_taxable       boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant   uuid := grip.current_tenant_id();
  v_user     uuid := grip.current_user_id();
  v_wo       grip.work_orders%ROWTYPE;
  v_settings grip.tenant_settings%ROWTYPE;
  v_mode     grip.labour_billing_mode;
  v_rate     numeric;
  v_billed   numeric;
  v_actual   numeric;
  v_id       uuid;
BEGIN
  IF coalesce(trim(p_description), '') = '' THEN
    RAISE EXCEPTION 'a labour line needs a description' USING ERRCODE = 'check_violation';
  END IF;
  IF p_hours IS NULL OR p_hours < 0 THEN
    RAISE EXCEPTION 'hours cannot be negative' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  PERFORM grip.assert_work_order_labour_editable(v_wo.status);

  IF p_tech_id IS NOT NULL THEN
    PERFORM 1 FROM grip.employees WHERE id = p_tech_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'technician not found'; END IF;
  END IF;

  SELECT * INTO v_settings FROM grip.tenant_settings WHERE tenant_id = v_tenant;
  v_mode := coalesce(p_mode, v_wo.labour_billing_mode);
  v_rate := coalesce(p_rate, v_settings.default_labour_rate, 0);

  IF v_mode = 'straight_time' THEN
    v_billed := p_hours;
    v_actual := p_hours;
  ELSE
    v_billed := p_hours;
    v_actual := coalesce(p_actual_hours, 0);
  END IF;

  INSERT INTO grip.work_order_labour_lines
    (tenant_id, work_order_id, description, billed_hours, actual_hours, rate,
     billing_mode, tech_id, is_taxable, added_by_user_id)
  VALUES
    (v_tenant, p_work_order_id, trim(p_description), v_billed, v_actual, v_rate,
     v_mode, p_tech_id, p_taxable, v_user)
  RETURNING id INTO v_id;

  PERFORM grip.recalculate_work_order(p_work_order_id);
  PERFORM grip.log_audit('labour.added', 'work_order', p_work_order_id,
    jsonb_build_object('line', v_id, 'description', trim(p_description),
                       'hours', v_billed, 'rate', v_rate, 'mode', v_mode));
  RETURN v_id;
END;
$$;

-- The old signature had no billing mode; the new one replaces it.
DROP FUNCTION IF EXISTS grip.update_labour_line(uuid, text, numeric, numeric, numeric, uuid, boolean);

CREATE OR REPLACE FUNCTION grip.update_labour_line(
  p_line_id       uuid,
  p_description   text,
  p_hours         numeric,
  p_actual_hours  numeric,
  p_rate          numeric,
  p_mode          grip.labour_billing_mode,
  p_tech_id       uuid,
  p_taxable       boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user   uuid := grip.current_user_id();
  v_line   grip.work_order_labour_lines%ROWTYPE;
  v_wo     grip.work_orders%ROWTYPE;
  v_actual numeric;
BEGIN
  SELECT * INTO v_line FROM grip.work_order_labour_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'labour line not found'; END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = v_line.work_order_id FOR UPDATE;
  PERFORM grip.assert_work_order_labour_editable(v_wo.status);

  IF coalesce(trim(p_description), '') = '' THEN
    RAISE EXCEPTION 'a labour line needs a description' USING ERRCODE = 'check_violation';
  END IF;
  IF p_hours < 0 OR p_rate < 0 OR coalesce(p_actual_hours, 0) < 0 THEN
    RAISE EXCEPTION 'hours and rate cannot be negative' USING ERRCODE = 'check_violation';
  END IF;

  IF p_tech_id IS NOT NULL THEN
    PERFORM 1 FROM grip.employees WHERE id = p_tech_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'technician not found'; END IF;
  END IF;

  -- Straight time bills what was worked, so the two hours columns are one number.
  v_actual := CASE WHEN p_mode = 'straight_time' THEN p_hours
                   ELSE coalesce(p_actual_hours, v_line.actual_hours) END;

  -- Nothing changed: no new edit, no noise in the activity trail.
  IF v_line.description = trim(p_description) AND v_line.billed_hours = p_hours
     AND v_line.actual_hours = v_actual AND v_line.rate = p_rate
     AND v_line.billing_mode = p_mode AND v_line.tech_id IS NOT DISTINCT FROM p_tech_id
     AND v_line.is_taxable = p_taxable THEN
    RETURN;
  END IF;

  UPDATE grip.work_order_labour_lines
  SET description       = trim(p_description),
      billed_hours      = p_hours,
      actual_hours      = v_actual,
      rate              = p_rate,
      billing_mode      = p_mode,
      tech_id           = p_tech_id,
      is_taxable        = p_taxable,
      edited_by_user_id = v_user,
      edited_at         = now(),
      updated_at        = now()
  WHERE id = p_line_id;

  PERFORM grip.recalculate_work_order(v_line.work_order_id);
  PERFORM grip.log_audit('labour.edited', 'work_order', v_line.work_order_id,
    jsonb_build_object('line', p_line_id, 'description', trim(p_description),
      'from', jsonb_build_object('hours', v_line.billed_hours, 'rate', v_line.rate,
                                 'description', v_line.description, 'mode', v_line.billing_mode,
                                 'taxable', v_line.is_taxable),
      'to',   jsonb_build_object('hours', p_hours, 'rate', p_rate,
                                 'description', trim(p_description), 'mode', p_mode,
                                 'taxable', p_taxable)));
END;
$$;

CREATE OR REPLACE FUNCTION grip.remove_labour_line(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_line grip.work_order_labour_lines%ROWTYPE;
  v_wo   grip.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM grip.work_order_labour_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'labour line not found'; END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = v_line.work_order_id FOR UPDATE;
  PERFORM grip.assert_work_order_labour_editable(v_wo.status);

  DELETE FROM grip.work_order_labour_lines WHERE id = p_line_id;
  PERFORM grip.recalculate_work_order(v_line.work_order_id);
  PERFORM grip.log_audit('labour.removed', 'work_order', v_line.work_order_id,
    jsonb_build_object('line', p_line_id, 'description', v_line.description));
END;
$$;

-- ---------------------------------------------------------------------------
-- Notes for the customer
-- ---------------------------------------------------------------------------

-- Free text, so it is editable in every status: correcting a typo in a note is
-- not a change to what the customer owes. It prints on the quote and invoice.
CREATE OR REPLACE FUNCTION grip.set_work_order_notes(p_work_order_id uuid, p_notes text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wo    grip.work_orders%ROWTYPE;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
BEGIN
  IF length(coalesce(v_notes, '')) > 5000 THEN
    RAISE EXCEPTION 'notes are limited to 5,000 characters' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  IF v_notes IS NOT DISTINCT FROM v_wo.notes THEN RETURN; END IF;

  UPDATE grip.work_orders SET notes = v_notes, updated_at = now() WHERE id = p_work_order_id;
  PERFORM grip.log_audit('work_order.notes_edited', 'work_order', p_work_order_id, NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- The order's concern and mileage, and who it is for
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.set_work_order_details(
  p_work_order_id uuid,
  p_concern       text,
  p_mileage_in    integer
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wo grip.work_orders%ROWTYPE;
BEGIN
  IF p_mileage_in IS NOT NULL AND p_mileage_in < 0 THEN
    RAISE EXCEPTION 'mileage cannot be negative' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  IF v_wo.status IN ('invoiced', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'the details cannot be changed on a work order that is %', v_wo.status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.work_orders
  SET concern = nullif(trim(coalesce(p_concern, '')), ''),
      mileage_in = p_mileage_in,
      updated_at = now()
  WHERE id = p_work_order_id;

  IF p_mileage_in IS NOT NULL THEN
    UPDATE grip.vehicles
    SET current_mileage = greatest(coalesce(current_mileage, 0), p_mileage_in)
    WHERE id = v_wo.vehicle_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION grip.set_work_order_customer(
  p_work_order_id uuid,
  p_customer_id   uuid,
  p_vehicle_id    uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wo       grip.work_orders%ROWTYPE;
  v_customer grip.customers%ROWTYPE;
  v_settings grip.tenant_settings%ROWTYPE;
  v_rate     uuid;
BEGIN
  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  IF v_wo.status IN ('invoiced', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'the customer cannot be changed on a work order that is %', v_wo.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_customer FROM grip.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer not found'; END IF;

  PERFORM 1 FROM grip.vehicles WHERE id = p_vehicle_id AND customer_id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that vehicle does not belong to this customer';
  END IF;

  -- Moving to a different customer takes on their tax arrangement, exactly as
  -- a new order would: an exempt customer's work is exempt. Staying with the
  -- same customer (just changing the vehicle) leaves the rate alone.
  IF p_customer_id IS DISTINCT FROM v_wo.customer_id THEN
    SELECT * INTO v_settings FROM grip.tenant_settings WHERE tenant_id = v_wo.tenant_id;
    v_rate := coalesce(v_customer.tax_rate_id, v_settings.default_tax_rate_id);
    UPDATE grip.work_orders
    SET customer_id = p_customer_id, vehicle_id = p_vehicle_id, tax_rate_id = v_rate,
        exempt_reason = CASE WHEN grip.rate_is_exempt(v_rate) AND grip.customer_exemption_live(p_customer_id)
                             THEN v_customer.exempt_reason END,
        exempt_reference = CASE WHEN grip.rate_is_exempt(v_rate) AND grip.customer_exemption_live(p_customer_id)
                                THEN v_customer.exempt_reference END,
        updated_at = now()
    WHERE id = p_work_order_id;
  ELSE
    UPDATE grip.work_orders
    SET vehicle_id = p_vehicle_id, updated_at = now()
    WHERE id = p_work_order_id;
  END IF;

  -- A booked appointment follows its order, so the schedule never disagrees.
  UPDATE grip.appointments
  SET customer_id = p_customer_id, vehicle_id = p_vehicle_id
  WHERE id = v_wo.appointment_id;

  PERFORM grip.recalculate_work_order(p_work_order_id);
  PERFORM grip.log_audit('work_order.customer_changed', 'work_order', p_work_order_id,
    jsonb_build_object('customer', v_customer.display_name,
                       'from_customer', v_wo.customer_id, 'to_customer', p_customer_id));
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
