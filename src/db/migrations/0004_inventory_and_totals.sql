-- Grip — 0004 — document numbering, the inventory reservation engine, totals.
--
-- These are SECURITY INVOKER on purpose: they run as grip_app and are subject
-- to row-level security like any other statement. Defence in depth — a bug
-- that passed a work order id from another tenant finds nothing, rather than
-- quietly moving that tenant's stock.

-- ---------------------------------------------------------------------------
-- Per-tenant document numbers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.next_document_number(p_kind text)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_next   integer;
BEGIN
  INSERT INTO grip.document_counters (tenant_id, kind, next_value)
  VALUES (v_tenant, p_kind, 1001)
  ON CONFLICT (tenant_id, kind) DO NOTHING;

  UPDATE grip.document_counters
  SET next_value = next_value + 1
  WHERE tenant_id = v_tenant AND kind = p_kind
  RETURNING next_value - 1 INTO v_next;

  RETURN v_next;
END;
$$;

-- ---------------------------------------------------------------------------
-- Totals, including tax as charged
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.recalculate_work_order(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wo              grip.work_orders%ROWTYPE;
  v_labour          numeric(12,2) := 0;
  v_parts           numeric(12,2) := 0;
  v_taxable_labour  numeric(12,2) := 0;
  v_taxable_parts   numeric(12,2) := 0;
  v_tax_total       numeric(12,2) := 0;
  v_rate            grip.tax_rates%ROWTYPE;
  v_component       RECORD;
  v_base            numeric(12,2);
  v_amount          numeric(12,2);
BEGIN
  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order % not found in this tenant', p_work_order_id;
  END IF;

  -- Billing always uses billed_hours. flat_rate and straight_time differ only
  -- in how billed_hours got its value, which keeps this arithmetic honest in
  -- either mode.
  SELECT
    coalesce(sum(billed_hours * rate), 0),
    coalesce(sum(billed_hours * rate) FILTER (WHERE is_taxable), 0)
  INTO v_labour, v_taxable_labour
  FROM grip.work_order_labour_lines WHERE work_order_id = p_work_order_id;

  SELECT
    coalesce(sum(qty * unit_price), 0),
    coalesce(sum(qty * unit_price) FILTER (WHERE is_taxable), 0)
  INTO v_parts, v_taxable_parts
  FROM grip.work_order_part_lines WHERE work_order_id = p_work_order_id;

  DELETE FROM grip.work_order_taxes WHERE work_order_id = p_work_order_id;

  IF v_wo.tax_rate_id IS NOT NULL THEN
    SELECT * INTO v_rate FROM grip.tax_rates WHERE id = v_wo.tax_rate_id;

    IF FOUND THEN
      FOR v_component IN
        SELECT * FROM grip.tax_rate_components
        WHERE tax_rate_id = v_rate.id
        ORDER BY sort_order, name
      LOOP
        v_base :=
          (CASE WHEN v_rate.applies_to_labour THEN v_taxable_labour ELSE 0 END) +
          (CASE WHEN v_rate.applies_to_parts  THEN v_taxable_parts  ELSE 0 END);

        -- numeric round() is half-away-from-zero, which is what a customer
        -- expects on an invoice. No floating point is involved anywhere here.
        v_amount := round(v_base * v_component.rate_bps / 10000.0, 2);
        v_tax_total := v_tax_total + v_amount;

        INSERT INTO grip.work_order_taxes
          (tenant_id, work_order_id, component_name, rate_bps, taxable_base, amount, sort_order)
        VALUES
          (v_wo.tenant_id, p_work_order_id, v_component.name, v_component.rate_bps,
           v_base, v_amount, v_component.sort_order);
      END LOOP;
    END IF;
  END IF;

  UPDATE grip.work_orders
  SET labour_subtotal = v_labour,
      parts_subtotal  = v_parts,
      subtotal        = v_labour + v_parts,
      tax_total       = v_tax_total,
      total           = v_labour + v_parts + v_tax_total
  WHERE id = p_work_order_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reservation engine
-- ---------------------------------------------------------------------------
--   available = qty_on_hand - qty_reserved
--
-- Adding a part to a quote or an active job reserves it: the stock is still
-- physically on the shelf, but nobody else can promise it. Completing the job
-- converts the reservation into consumption. Removing the line releases it.

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
  IF v_wo.status IN ('invoiced', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'cannot add parts to a work order that is %', v_wo.status;
  END IF;

  SELECT * INTO v_part FROM grip.parts WHERE id = p_part_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'part % not found in this tenant', p_part_id;
  END IF;

  -- The lock that makes two advisors grabbing the last alternator safe. Taken
  -- on the narrow stock row, held until this transaction commits.
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
BEGIN
  SELECT * INTO v_line FROM grip.work_order_part_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'part line % not found in this tenant', p_line_id;
  END IF;

  IF v_line.qty_consumed > 0 THEN
    RAISE EXCEPTION 'cannot remove a line whose parts have already been consumed';
  END IF;

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
END;
$$;

-- Completing the job is where reserved stock actually leaves the shelf.
CREATE OR REPLACE FUNCTION grip.complete_work_order(
  p_work_order_id uuid,
  p_user_id       uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_wo     grip.work_orders%ROWTYPE;
  v_line   grip.work_order_part_lines%ROWTYPE;
BEGIN
  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order % not found in this tenant', p_work_order_id;
  END IF;
  IF v_wo.status IN ('completed', 'invoiced', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'work order % is already %', v_wo.number, v_wo.status;
  END IF;

  FOR v_line IN
    SELECT * FROM grip.work_order_part_lines
    WHERE work_order_id = p_work_order_id AND qty_reserved > 0
    ORDER BY part_id          -- consistent lock order; no deadlock between jobs
  LOOP
    PERFORM 1 FROM grip.part_stock WHERE part_id = v_line.part_id FOR UPDATE;

    UPDATE grip.part_stock
    SET qty_on_hand  = qty_on_hand - v_line.qty_reserved,
        qty_reserved = qty_reserved - v_line.qty_reserved,
        updated_at   = now()
    WHERE part_id = v_line.part_id;

    INSERT INTO grip.stock_movements
      (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
    VALUES
      (v_tenant, v_line.part_id, 'consume', -v_line.qty_reserved,
       'work_order', p_work_order_id, p_user_id,
       'consumed on work order ' || v_wo.number);

    UPDATE grip.work_order_part_lines
    SET qty_consumed = qty_consumed + v_line.qty_reserved,
        qty_reserved = 0
    WHERE id = v_line.id;
  END LOOP;

  UPDATE grip.work_orders
  SET status = 'completed', completed_at = now()
  WHERE id = p_work_order_id;
END;
$$;

-- Cancelling gives everything back.
CREATE OR REPLACE FUNCTION grip.cancel_work_order(
  p_work_order_id uuid,
  p_user_id       uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_line   grip.work_order_part_lines%ROWTYPE;
BEGIN
  FOR v_line IN
    SELECT * FROM grip.work_order_part_lines
    WHERE work_order_id = p_work_order_id AND qty_reserved > 0
    ORDER BY part_id
  LOOP
    PERFORM 1 FROM grip.part_stock WHERE part_id = v_line.part_id FOR UPDATE;

    UPDATE grip.part_stock
    SET qty_reserved = qty_reserved - v_line.qty_reserved, updated_at = now()
    WHERE part_id = v_line.part_id;

    INSERT INTO grip.stock_movements
      (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
    VALUES
      (v_tenant, v_line.part_id, 'release', -v_line.qty_reserved,
       'work_order', p_work_order_id, p_user_id, 'work order cancelled');

    UPDATE grip.work_order_part_lines SET qty_reserved = 0 WHERE id = v_line.id;
  END LOOP;

  UPDATE grip.work_orders SET status = 'cancelled' WHERE id = p_work_order_id;
END;
$$;

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

  PERFORM grip.recalculate_work_order(p_work_order_id);
  UPDATE grip.work_orders
  SET status = 'invoiced', invoiced_at = now()
  WHERE id = p_work_order_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Counter sales — stock leaves immediately, no reservation step
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.recalculate_counter_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sale      grip.counter_sales%ROWTYPE;
  v_subtotal  numeric(12,2) := 0;
  v_taxable   numeric(12,2) := 0;
  v_tax_total numeric(12,2) := 0;
  v_rate      grip.tax_rates%ROWTYPE;
  v_component RECORD;
  v_amount    numeric(12,2);
BEGIN
  SELECT * INTO v_sale FROM grip.counter_sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'counter sale % not found in this tenant', p_sale_id;
  END IF;

  SELECT coalesce(sum(qty * unit_price), 0),
         coalesce(sum(qty * unit_price) FILTER (WHERE is_taxable), 0)
  INTO v_subtotal, v_taxable
  FROM grip.counter_sale_lines WHERE counter_sale_id = p_sale_id;

  DELETE FROM grip.counter_sale_taxes WHERE counter_sale_id = p_sale_id;

  IF v_sale.tax_rate_id IS NOT NULL THEN
    SELECT * INTO v_rate FROM grip.tax_rates WHERE id = v_sale.tax_rate_id;
    IF FOUND AND v_rate.applies_to_parts THEN
      FOR v_component IN
        SELECT * FROM grip.tax_rate_components
        WHERE tax_rate_id = v_rate.id ORDER BY sort_order, name
      LOOP
        v_amount := round(v_taxable * v_component.rate_bps / 10000.0, 2);
        v_tax_total := v_tax_total + v_amount;
        INSERT INTO grip.counter_sale_taxes
          (tenant_id, counter_sale_id, component_name, rate_bps, taxable_base, amount, sort_order)
        VALUES
          (v_sale.tenant_id, p_sale_id, v_component.name, v_component.rate_bps,
           v_taxable, v_amount, v_component.sort_order);
      END LOOP;
    END IF;
  END IF;

  UPDATE grip.counter_sales
  SET subtotal = v_subtotal, tax_total = v_tax_total, total = v_subtotal + v_tax_total
  WHERE id = p_sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.add_part_to_counter_sale(
  p_sale_id uuid,
  p_part_id uuid,
  p_qty     integer,
  p_user_id uuid,
  p_allow_backorder boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant    uuid := grip.current_tenant_id();
  v_part      grip.parts%ROWTYPE;
  v_stock     grip.part_stock%ROWTYPE;
  v_available integer;
  v_line_id   uuid;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
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

  -- A counter sale competes with work-order reservations for the same shelf,
  -- so it must respect qty_reserved too.
  v_available := v_stock.qty_on_hand - v_stock.qty_reserved;
  IF p_qty > v_available AND NOT p_allow_backorder THEN
    RAISE EXCEPTION
      'insufficient stock for %: % available, % requested',
      v_part.sku, greatest(v_available, 0), p_qty
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.part_stock
  SET qty_on_hand = qty_on_hand - p_qty, updated_at = now()
  WHERE part_id = p_part_id;

  INSERT INTO grip.stock_movements
    (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
  VALUES
    (v_tenant, p_part_id, 'sale', -p_qty, 'counter_sale', p_sale_id, p_user_id, NULL);

  INSERT INTO grip.counter_sale_lines
    (tenant_id, counter_sale_id, part_id, description, qty, unit_cost, unit_price, added_by_user_id)
  VALUES
    (v_tenant, p_sale_id, p_part_id, v_part.description, p_qty,
     v_part.unit_cost, v_part.unit_price, p_user_id)
  RETURNING id INTO v_line_id;

  PERFORM grip.recalculate_counter_sale(p_sale_id);
  RETURN v_line_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Receiving against a purchase order
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.receive_purchase_order_line(
  p_line_id uuid,
  p_qty     integer,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_line   grip.purchase_order_lines%ROWTYPE;
  v_outstanding integer;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'received quantity must be positive';
  END IF;

  SELECT * INTO v_line FROM grip.purchase_order_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase order line % not found in this tenant', p_line_id;
  END IF;

  v_outstanding := v_line.qty_ordered - v_line.qty_received;
  IF p_qty > v_outstanding THEN
    RAISE EXCEPTION 'cannot receive % when only % are outstanding', p_qty, v_outstanding;
  END IF;

  PERFORM 1 FROM grip.part_stock WHERE part_id = v_line.part_id FOR UPDATE;

  INSERT INTO grip.part_stock (part_id, tenant_id, qty_on_hand)
  VALUES (v_line.part_id, v_tenant, p_qty)
  ON CONFLICT (part_id) DO UPDATE
  SET qty_on_hand  = grip.part_stock.qty_on_hand + p_qty,
      qty_on_order = greatest(grip.part_stock.qty_on_order - p_qty, 0),
      updated_at   = now();

  INSERT INTO grip.stock_movements
    (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
  VALUES
    (v_tenant, v_line.part_id, 'receive', p_qty, 'purchase_order',
     v_line.purchase_order_id, p_user_id, NULL);

  UPDATE grip.purchase_order_lines
  SET qty_received = qty_received + p_qty WHERE id = p_line_id;

  UPDATE grip.purchase_orders po
  SET status = CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM grip.purchase_order_lines l
      WHERE l.purchase_order_id = po.id AND l.qty_received < l.qty_ordered
    ) THEN 'received'::grip.purchase_order_status
    ELSE 'partial'::grip.purchase_order_status
  END
  WHERE po.id = v_line.purchase_order_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Manual stock adjustment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.adjust_stock(
  p_part_id uuid,
  p_delta   integer,
  p_reason  text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'adjustment must be non-zero';
  END IF;

  PERFORM 1 FROM grip.part_stock WHERE part_id = p_part_id FOR UPDATE;

  INSERT INTO grip.part_stock (part_id, tenant_id, qty_on_hand)
  VALUES (p_part_id, v_tenant, p_delta)
  ON CONFLICT (part_id) DO UPDATE
  SET qty_on_hand = grip.part_stock.qty_on_hand + p_delta, updated_at = now();

  INSERT INTO grip.stock_adjustments (tenant_id, part_id, delta, reason, user_id)
  VALUES (v_tenant, p_part_id, p_delta, p_reason, p_user_id);

  INSERT INTO grip.stock_movements
    (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
  VALUES (v_tenant, p_part_id, 'adjust', p_delta, 'adjustment', NULL, p_user_id, p_reason);
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
