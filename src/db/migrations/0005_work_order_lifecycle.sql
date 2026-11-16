-- Grip — 0005 — work order lifecycle, labour lines, audit trail.
--
-- The rules of a work order live here, next to the reservation engine, rather
-- than in the UI: which states accept new lines, which transitions are legal,
-- and who did what. A second front end (or a bug in the first) cannot skip
-- them. All of these run as grip_app under row-level security.
--
-- Actor identity comes from app.user_id, which the server sets from the
-- verified session — never from a parameter the caller could forge.

-- ---------------------------------------------------------------------------
-- Audit helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.log_audit(
  p_action    text,
  p_entity    text,
  p_entity_id uuid,
  p_diff      jsonb DEFAULT NULL,
  p_actor     uuid  DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO grip.audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
  VALUES (grip.current_tenant_id(), coalesce(p_actor, grip.current_user_id()),
          p_action, p_entity, p_entity_id, p_diff);
$$;

-- Lines may be added, edited or removed only while the job is still open.
CREATE OR REPLACE FUNCTION grip.assert_work_order_editable(p_status grip.work_order_status)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_status NOT IN ('quote', 'approved', 'in_progress') THEN
    RAISE EXCEPTION 'cannot change lines on a work order that is %', p_status
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Creating a work order
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

  v_number := grip.next_document_number('work_order');

  INSERT INTO grip.work_orders
    (tenant_id, number, customer_id, vehicle_id, status, concern, mileage_in,
     service_advisor_id, opened_by, tax_rate_id, labour_billing_mode)
  VALUES
    (v_tenant, v_number, p_customer_id, p_vehicle_id, 'quote', nullif(trim(p_concern), ''),
     p_mileage_in,
     CASE WHEN v_role = 'service_advisor' THEN v_user END,
     v_user,
     -- A tax-exempt customer (fleet, First Nations, wholesale) overrides the
     -- shop default.
     coalesce(v_customer.tax_rate_id, v_settings.default_tax_rate_id),
     coalesce(v_settings.labour_billing_mode, 'flat_rate'))
  RETURNING id INTO v_id;

  -- Mileage history: the vehicle's current reading only ever moves forward.
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

-- ---------------------------------------------------------------------------
-- Per-document options: tax rate and labour mode
-- ---------------------------------------------------------------------------

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
  PERFORM grip.recalculate_work_order(p_work_order_id);
  PERFORM grip.log_audit('work_order.tax_changed', 'work_order', p_work_order_id,
    jsonb_build_object('from', v_wo.tax_rate_id, 'to', p_tax_rate_id, 'name', v_rate.name));
END;
$$;

-- Sets the default for NEW labour lines. Existing lines keep their own mode, so
-- flipping this never silently reprices work already written up.
CREATE OR REPLACE FUNCTION grip.set_work_order_labour_mode(
  p_work_order_id uuid, p_mode grip.labour_billing_mode
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wo grip.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  PERFORM grip.assert_work_order_editable(v_wo.status);

  UPDATE grip.work_orders SET labour_billing_mode = p_mode WHERE id = p_work_order_id;
  PERFORM grip.log_audit('work_order.labour_mode_changed', 'work_order', p_work_order_id,
    jsonb_build_object('from', v_wo.labour_billing_mode, 'to', p_mode));
END;
$$;

-- ---------------------------------------------------------------------------
-- Labour lines
-- ---------------------------------------------------------------------------
-- p_hours means what the mode says it means:
--   flat_rate     -> book time the customer is billed; p_actual_hours is what
--                    the tech really took (optional, feeds efficiency)
--   straight_time -> hours actually worked; billed and actual are the same
-- Either way billing is billed_hours x rate, so the totals arithmetic has one
-- path and technician efficiency (billed / actual) is meaningful in both.

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
  PERFORM grip.assert_work_order_editable(v_wo.status);

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

CREATE OR REPLACE FUNCTION grip.update_labour_line(
  p_line_id       uuid,
  p_description   text,
  p_hours         numeric,
  p_actual_hours  numeric,
  p_rate          numeric,
  p_tech_id       uuid,
  p_taxable       boolean
)
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
  PERFORM grip.assert_work_order_editable(v_wo.status);

  IF coalesce(trim(p_description), '') = '' THEN
    RAISE EXCEPTION 'a labour line needs a description' USING ERRCODE = 'check_violation';
  END IF;
  IF p_hours < 0 OR p_rate < 0 THEN
    RAISE EXCEPTION 'hours and rate cannot be negative' USING ERRCODE = 'check_violation';
  END IF;

  IF p_tech_id IS NOT NULL THEN
    PERFORM 1 FROM grip.employees WHERE id = p_tech_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'technician not found'; END IF;
  END IF;

  UPDATE grip.work_order_labour_lines
  SET description  = trim(p_description),
      billed_hours = p_hours,
      actual_hours = CASE WHEN billing_mode = 'straight_time' THEN p_hours
                          ELSE coalesce(p_actual_hours, actual_hours) END,
      rate         = p_rate,
      tech_id      = p_tech_id,
      is_taxable   = p_taxable
  WHERE id = p_line_id;

  PERFORM grip.recalculate_work_order(v_line.work_order_id);
  PERFORM grip.log_audit('labour.edited', 'work_order', v_line.work_order_id,
    jsonb_build_object('line', p_line_id,
      'from', jsonb_build_object('hours', v_line.billed_hours, 'rate', v_line.rate,
                                 'description', v_line.description),
      'to',   jsonb_build_object('hours', p_hours, 'rate', p_rate,
                                 'description', trim(p_description))));
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
  PERFORM grip.assert_work_order_editable(v_wo.status);

  DELETE FROM grip.work_order_labour_lines WHERE id = p_line_id;
  PERFORM grip.recalculate_work_order(v_line.work_order_id);
  PERFORM grip.log_audit('labour.removed', 'work_order', v_line.work_order_id,
    jsonb_build_object('line', p_line_id, 'description', v_line.description,
                       'hours', v_line.billed_hours));
END;
$$;

-- ---------------------------------------------------------------------------
-- Part lines: 0004's functions, tightened and now audited
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.add_part_to_work_order(
  p_work_order_id   uuid,
  p_part_id         uuid,
  p_qty             integer,
  p_user_id         uuid,
  p_allow_backorder boolean DEFAULT false,
  p_unit_price      numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant     uuid := grip.current_tenant_id();
  v_wo         grip.work_orders%ROWTYPE;
  v_part       grip.parts%ROWTYPE;
  v_stock      grip.part_stock%ROWTYPE;
  v_available  integer;
  v_reserve    integer;
  v_backorder  integer;
  v_line_id    uuid;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order % not found in this tenant', p_work_order_id;
  END IF;
  -- Reservation only makes sense while the job is open. A completed job has
  -- already consumed its parts, so adding one now would reserve stock that no
  -- later step ever releases or consumes.
  IF v_wo.status NOT IN ('quote', 'approved', 'in_progress') THEN
    RAISE EXCEPTION 'cannot add parts to a work order that is %', v_wo.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_part FROM grip.parts WHERE id = p_part_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'part % not found in this tenant', p_part_id;
  END IF;

  SELECT * INTO v_stock FROM grip.part_stock WHERE part_id = p_part_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO grip.part_stock (part_id, tenant_id) VALUES (p_part_id, v_tenant)
    RETURNING * INTO v_stock;
  END IF;

  v_available := v_stock.qty_on_hand - v_stock.qty_reserved;
  v_reserve   := least(p_qty, greatest(v_available, 0));
  v_backorder := p_qty - v_reserve;

  IF v_backorder > 0 AND NOT p_allow_backorder THEN
    RAISE EXCEPTION
      'insufficient stock for %: % available, % requested',
      v_part.sku, greatest(v_available, 0), p_qty
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_reserve > 0 THEN
    UPDATE grip.part_stock
    SET qty_reserved = qty_reserved + v_reserve, updated_at = now()
    WHERE part_id = p_part_id;

    INSERT INTO grip.stock_movements
      (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
    VALUES
      (v_tenant, p_part_id, 'reserve', v_reserve, 'work_order', p_work_order_id,
       p_user_id, 'reserved for work order ' || v_wo.number);
  END IF;

  INSERT INTO grip.work_order_part_lines
    (tenant_id, work_order_id, part_id, description, qty, unit_cost, unit_price,
     qty_reserved, qty_backordered, added_by_user_id)
  VALUES
    (v_tenant, p_work_order_id, p_part_id, v_part.description, p_qty,
     v_part.unit_cost, coalesce(p_unit_price, v_part.unit_price),
     v_reserve, v_backorder, p_user_id)
  RETURNING id INTO v_line_id;

  PERFORM grip.recalculate_work_order(p_work_order_id);
  PERFORM grip.log_audit('part.added', 'work_order', p_work_order_id,
    jsonb_build_object('line', v_line_id, 'sku', v_part.sku, 'description', v_part.description,
                       'qty', p_qty, 'reserved', v_reserve, 'backordered', v_backorder),
    p_user_id);
  RETURN v_line_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.remove_part_from_work_order(
  p_line_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_line   grip.work_order_part_lines%ROWTYPE;
  v_wo     grip.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM grip.work_order_part_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'part line % not found in this tenant', p_line_id;
  END IF;

  IF v_line.qty_consumed > 0 THEN
    RAISE EXCEPTION 'cannot remove a line whose parts have already been consumed';
  END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = v_line.work_order_id;
  PERFORM grip.assert_work_order_editable(v_wo.status);

  IF v_line.qty_reserved > 0 THEN
    PERFORM 1 FROM grip.part_stock WHERE part_id = v_line.part_id FOR UPDATE;

    UPDATE grip.part_stock
    SET qty_reserved = qty_reserved - v_line.qty_reserved, updated_at = now()
    WHERE part_id = v_line.part_id;

    INSERT INTO grip.stock_movements
      (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
    VALUES
      (v_tenant, v_line.part_id, 'release', -v_line.qty_reserved,
       'work_order', v_line.work_order_id, p_user_id, 'line removed');
  END IF;

  DELETE FROM grip.work_order_part_lines WHERE id = p_line_id;
  PERFORM grip.recalculate_work_order(v_line.work_order_id);
  PERFORM grip.log_audit('part.removed', 'work_order', v_line.work_order_id,
    jsonb_build_object('line', p_line_id, 'description', v_line.description, 'qty', v_line.qty),
    p_user_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- The state machine
-- ---------------------------------------------------------------------------
--   quote -> approved -> in_progress -> completed -> invoiced -> paid
--   quote | approved | in_progress -> cancelled
--
-- Completing consumes reserved stock; cancelling releases it. Both reuse the
-- 0004 functions, which already hold the stock-row locks.

CREATE OR REPLACE FUNCTION grip.transition_work_order(
  p_work_order_id uuid,
  p_to            grip.work_order_status
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user uuid := grip.current_user_id();
  v_wo   grip.work_orders%ROWTYPE;
  v_ok   boolean;
BEGIN
  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;

  v_ok := CASE v_wo.status
    WHEN 'quote'       THEN p_to IN ('approved', 'cancelled')
    WHEN 'approved'    THEN p_to IN ('in_progress', 'cancelled')
    WHEN 'in_progress' THEN p_to IN ('completed', 'cancelled')
    WHEN 'completed'   THEN p_to = 'invoiced'
    WHEN 'invoiced'    THEN p_to = 'paid'
    ELSE false
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'a work order that is % cannot move to %', v_wo.status, p_to
      USING ERRCODE = 'check_violation';
  END IF;

  CASE p_to
    WHEN 'approved' THEN
      UPDATE grip.work_orders SET status = 'approved', approved_at = now()
      WHERE id = p_work_order_id;
    WHEN 'in_progress' THEN
      UPDATE grip.work_orders SET status = 'in_progress' WHERE id = p_work_order_id;
    WHEN 'completed' THEN
      PERFORM grip.complete_work_order(p_work_order_id, v_user);
    WHEN 'invoiced' THEN
      PERFORM grip.invoice_work_order(p_work_order_id);
    WHEN 'paid' THEN
      UPDATE grip.work_orders SET status = 'paid', paid_at = now()
      WHERE id = p_work_order_id;
    WHEN 'cancelled' THEN
      PERFORM grip.cancel_work_order(p_work_order_id, v_user);
    ELSE
      RAISE EXCEPTION 'unsupported transition';
  END CASE;

  PERFORM grip.log_audit('work_order.' || p_to::text, 'work_order', p_work_order_id,
    jsonb_build_object('from', v_wo.status, 'to', p_to));
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
