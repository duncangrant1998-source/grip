-- Grip — 0006 — the parts side: purchase orders, receiving, counts,
-- and the counter-sale lifecycle.
--
-- As with 0005, the rules live here so no front end can skip them. Everything
-- runs as grip_app under row-level security, and actor identity comes from the
-- verified session setting (app.user_id), not from a parameter.
--
-- Stock rows are always locked in part_id order when a function touches more
-- than one, so two jobs competing for overlapping parts cannot deadlock.

-- ---------------------------------------------------------------------------
-- Manual adjustment and cycle count
-- ---------------------------------------------------------------------------

-- Replaces 0004's version: a reason is now mandatory, and on-hand may not be
-- pushed below what is reserved for open jobs (that would promise stock that
-- is not on the shelf).
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
  v_stock  grip.part_stock%ROWTYPE;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'adjustment must be non-zero' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'a reason is required for a stock adjustment' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM grip.parts WHERE id = p_part_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'part not found'; END IF;

  INSERT INTO grip.part_stock (part_id, tenant_id) VALUES (p_part_id, v_tenant)
  ON CONFLICT (part_id) DO NOTHING;

  SELECT * INTO v_stock FROM grip.part_stock WHERE part_id = p_part_id FOR UPDATE;

  IF v_stock.qty_on_hand + p_delta < v_stock.qty_reserved THEN
    RAISE EXCEPTION
      'cannot reduce on-hand to % — % are reserved for open jobs',
      v_stock.qty_on_hand + p_delta, v_stock.qty_reserved
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.part_stock
  SET qty_on_hand = qty_on_hand + p_delta, updated_at = now()
  WHERE part_id = p_part_id;

  INSERT INTO grip.stock_adjustments (tenant_id, part_id, delta, reason, user_id)
  VALUES (v_tenant, p_part_id, p_delta, trim(p_reason), p_user_id);

  INSERT INTO grip.stock_movements
    (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
  VALUES (v_tenant, p_part_id, 'adjust', p_delta, 'adjustment', NULL, p_user_id, trim(p_reason));

  PERFORM grip.log_audit('stock.adjusted', 'part', p_part_id,
    jsonb_build_object('delta', p_delta, 'reason', trim(p_reason),
                       'from', v_stock.qty_on_hand, 'to', v_stock.qty_on_hand + p_delta),
    p_user_id);
END;
$$;

-- A cycle count states what is actually on the shelf; the delta is worked out
-- under the row lock, so a sale landing mid-count cannot make it wrong.
CREATE OR REPLACE FUNCTION grip.count_stock(
  p_part_id uuid,
  p_counted integer,
  p_note    text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_user   uuid := grip.current_user_id();
  v_on_hand integer;
  v_delta   integer;
BEGIN
  IF p_counted IS NULL OR p_counted < 0 THEN
    RAISE EXCEPTION 'a count cannot be negative' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM grip.parts WHERE id = p_part_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'part not found'; END IF;

  INSERT INTO grip.part_stock (part_id, tenant_id) VALUES (p_part_id, v_tenant)
  ON CONFLICT (part_id) DO NOTHING;

  SELECT qty_on_hand INTO v_on_hand FROM grip.part_stock WHERE part_id = p_part_id FOR UPDATE;
  v_delta := p_counted - v_on_hand;
  IF v_delta = 0 THEN
    RETURN 0;
  END IF;

  PERFORM grip.adjust_stock(p_part_id, v_delta,
    'Cycle count: counted ' || p_counted || ', system had ' || v_on_hand ||
      CASE WHEN coalesce(trim(p_note), '') <> '' THEN ' — ' || trim(p_note) ELSE '' END,
    v_user);
  RETURN v_delta;
END;
$$;

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.recalculate_purchase_order(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_po       grip.purchase_orders%ROWTYPE;
  v_subtotal numeric(12,2);
  v_tax      numeric(12,2) := 0;
  v_rate     grip.tax_rates%ROWTYPE;
  v_c        RECORD;
BEGIN
  SELECT * INTO v_po FROM grip.purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase order not found'; END IF;

  SELECT coalesce(sum(qty_ordered * unit_cost), 0) INTO v_subtotal
  FROM grip.purchase_order_lines WHERE purchase_order_id = p_po_id;

  IF v_po.tax_rate_id IS NOT NULL THEN
    SELECT * INTO v_rate FROM grip.tax_rates WHERE id = v_po.tax_rate_id;
    IF FOUND AND v_rate.applies_to_parts THEN
      FOR v_c IN SELECT rate_bps FROM grip.tax_rate_components WHERE tax_rate_id = v_rate.id
      LOOP
        v_tax := v_tax + round(v_subtotal * v_c.rate_bps / 10000.0, 2);
      END LOOP;
    END IF;
  END IF;

  UPDATE grip.purchase_orders
  SET subtotal = v_subtotal, tax_total = v_tax, total = v_subtotal + v_tax
  WHERE id = p_po_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.create_purchase_order(
  p_supplier_id uuid,
  p_expected    date DEFAULT NULL,
  p_tax_rate_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_number integer;
  v_id     uuid;
  v_lead   integer;
BEGIN
  SELECT lead_time_days INTO v_lead FROM grip.suppliers WHERE id = p_supplier_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'supplier not found'; END IF;

  IF p_tax_rate_id IS NOT NULL THEN
    PERFORM 1 FROM grip.tax_rates WHERE id = p_tax_rate_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'tax rate not found'; END IF;
  END IF;

  v_number := grip.next_document_number('purchase_order');

  INSERT INTO grip.purchase_orders
    (tenant_id, number, supplier_id, status, tax_rate_id, expected_at, created_by)
  VALUES
    (v_tenant, v_number, p_supplier_id, 'draft', p_tax_rate_id,
     coalesce(p_expected, current_date + coalesce(v_lead, 2)), grip.current_user_id())
  RETURNING id INTO v_id;

  PERFORM grip.log_audit('purchase_order.created', 'purchase_order', v_id,
    jsonb_build_object('number', v_number));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.set_purchase_order_options(
  p_po_id uuid, p_expected date, p_tax_rate_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_po grip.purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_po FROM grip.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase order not found'; END IF;
  IF v_po.status NOT IN ('draft', 'ordered') THEN
    RAISE EXCEPTION 'a purchase order that is % cannot be edited', v_po.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_tax_rate_id IS NOT NULL THEN
    PERFORM 1 FROM grip.tax_rates WHERE id = p_tax_rate_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'tax rate not found'; END IF;
  END IF;

  UPDATE grip.purchase_orders
  SET expected_at = p_expected, tax_rate_id = p_tax_rate_id
  WHERE id = p_po_id;
  PERFORM grip.recalculate_purchase_order(p_po_id);
END;
$$;

-- Lines are editable only while the order is still a draft: once it has been
-- placed with the supplier, qty_on_order has been committed against it.
CREATE OR REPLACE FUNCTION grip.add_purchase_order_line(
  p_po_id     uuid,
  p_part_id   uuid,
  p_qty       integer,
  p_unit_cost numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_po     grip.purchase_orders%ROWTYPE;
  v_part   grip.parts%ROWTYPE;
  v_id     uuid;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = 'check_violation';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'cost cannot be negative' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_po FROM grip.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase order not found'; END IF;
  IF v_po.status <> 'draft' THEN
    RAISE EXCEPTION 'lines can only be changed on a draft purchase order'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_part FROM grip.parts WHERE id = p_part_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'part not found'; END IF;

  -- One line per part: adding it again increases the quantity.
  SELECT id INTO v_id FROM grip.purchase_order_lines
  WHERE purchase_order_id = p_po_id AND part_id = p_part_id;

  IF v_id IS NOT NULL THEN
    UPDATE grip.purchase_order_lines
    SET qty_ordered = qty_ordered + p_qty,
        unit_cost = coalesce(p_unit_cost, unit_cost)
    WHERE id = v_id;
  ELSE
    INSERT INTO grip.purchase_order_lines
      (tenant_id, purchase_order_id, part_id, qty_ordered, unit_cost)
    VALUES (v_tenant, p_po_id, p_part_id, p_qty, coalesce(p_unit_cost, v_part.unit_cost))
    RETURNING id INTO v_id;
  END IF;

  PERFORM grip.recalculate_purchase_order(p_po_id);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.update_purchase_order_line(
  p_line_id uuid, p_qty integer, p_unit_cost numeric
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_line grip.purchase_order_lines%ROWTYPE;
  v_po   grip.purchase_orders%ROWTYPE;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = 'check_violation';
  END IF;
  IF p_unit_cost < 0 THEN
    RAISE EXCEPTION 'cost cannot be negative' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_line FROM grip.purchase_order_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'line not found'; END IF;
  SELECT * INTO v_po FROM grip.purchase_orders WHERE id = v_line.purchase_order_id FOR UPDATE;
  IF v_po.status <> 'draft' THEN
    RAISE EXCEPTION 'lines can only be changed on a draft purchase order'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.purchase_order_lines SET qty_ordered = p_qty, unit_cost = p_unit_cost
  WHERE id = p_line_id;
  PERFORM grip.recalculate_purchase_order(v_po.id);
END;
$$;

CREATE OR REPLACE FUNCTION grip.remove_purchase_order_line(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_line grip.purchase_order_lines%ROWTYPE;
  v_po   grip.purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM grip.purchase_order_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'line not found'; END IF;
  SELECT * INTO v_po FROM grip.purchase_orders WHERE id = v_line.purchase_order_id FOR UPDATE;
  IF v_po.status <> 'draft' THEN
    RAISE EXCEPTION 'lines can only be changed on a draft purchase order'
      USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM grip.purchase_order_lines WHERE id = p_line_id;
  PERFORM grip.recalculate_purchase_order(v_po.id);
END;
$$;

-- Placing the order commits it with the supplier and counts it as "on order".
CREATE OR REPLACE FUNCTION grip.place_purchase_order(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_po     grip.purchase_orders%ROWTYPE;
  v_line   grip.purchase_order_lines%ROWTYPE;
BEGIN
  SELECT * INTO v_po FROM grip.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase order not found'; END IF;
  IF v_po.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft purchase order can be placed (this one is %)', v_po.status
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM grip.purchase_order_lines WHERE purchase_order_id = p_po_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'add at least one line before placing the order'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_line IN
    SELECT * FROM grip.purchase_order_lines WHERE purchase_order_id = p_po_id ORDER BY part_id
  LOOP
    INSERT INTO grip.part_stock (part_id, tenant_id, qty_on_order)
    VALUES (v_line.part_id, v_tenant, v_line.qty_ordered)
    ON CONFLICT (part_id) DO UPDATE
    SET qty_on_order = grip.part_stock.qty_on_order + v_line.qty_ordered, updated_at = now();
  END LOOP;

  UPDATE grip.purchase_orders SET status = 'ordered' WHERE id = p_po_id;
  PERFORM grip.log_audit('purchase_order.placed', 'purchase_order', p_po_id,
    jsonb_build_object('total', v_po.total));
END;
$$;

-- Receiving.
--   * stock goes on the shelf and comes off "on order";
--   * the part's cost becomes a moving average, so margin reports reflect what
--     the stock actually cost rather than the last invoice;
--   * parts a job was waiting on are allocated straight away, oldest first.
-- (Dropped first because the return type changed from void to integer.)
DROP FUNCTION IF EXISTS grip.receive_purchase_order_line(uuid, integer, uuid);
CREATE FUNCTION grip.receive_purchase_order_line(
  p_line_id uuid,
  p_qty     integer,
  p_user_id uuid
)
RETURNS integer   -- how many units were immediately allocated to waiting jobs
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant      uuid := grip.current_tenant_id();
  v_line        grip.purchase_order_lines%ROWTYPE;
  v_po          grip.purchase_orders%ROWTYPE;
  v_part        grip.parts%ROWTYPE;
  v_stock       grip.part_stock%ROWTYPE;
  v_outstanding integer;
  v_new_cost    numeric(12,2);
  v_avail       integer;
  v_take        integer;
  v_filled      integer := 0;
  v_bo          RECORD;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'received quantity must be positive' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_line FROM grip.purchase_order_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase order line % not found in this tenant', p_line_id;
  END IF;

  SELECT * INTO v_po FROM grip.purchase_orders WHERE id = v_line.purchase_order_id FOR UPDATE;
  IF v_po.status NOT IN ('ordered', 'partial') THEN
    RAISE EXCEPTION 'a purchase order that is % cannot be received against', v_po.status
      USING ERRCODE = 'check_violation';
  END IF;

  v_outstanding := v_line.qty_ordered - v_line.qty_received;
  IF p_qty > v_outstanding THEN
    RAISE EXCEPTION 'cannot receive % when only % are outstanding', p_qty, v_outstanding
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_part FROM grip.parts WHERE id = v_line.part_id FOR UPDATE;

  INSERT INTO grip.part_stock (part_id, tenant_id) VALUES (v_line.part_id, v_tenant)
  ON CONFLICT (part_id) DO NOTHING;
  SELECT * INTO v_stock FROM grip.part_stock WHERE part_id = v_line.part_id FOR UPDATE;

  v_new_cost := CASE
    WHEN v_stock.qty_on_hand > 0 THEN
      round((v_stock.qty_on_hand * v_part.unit_cost + p_qty * v_line.unit_cost)
            / (v_stock.qty_on_hand + p_qty), 2)
    ELSE v_line.unit_cost
  END;

  UPDATE grip.parts SET unit_cost = v_new_cost WHERE id = v_line.part_id;

  UPDATE grip.part_stock
  SET qty_on_hand  = qty_on_hand + p_qty,
      qty_on_order = greatest(qty_on_order - p_qty, 0),
      updated_at   = now()
  WHERE part_id = v_line.part_id;

  INSERT INTO grip.stock_movements
    (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
  VALUES
    (v_tenant, v_line.part_id, 'receive', p_qty, 'purchase_order', v_po.id, p_user_id,
     'received on PO ' || v_po.number);

  UPDATE grip.purchase_order_lines SET qty_received = qty_received + p_qty WHERE id = p_line_id;

  UPDATE grip.purchase_orders po
  SET status = CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM grip.purchase_order_lines l
      WHERE l.purchase_order_id = po.id AND l.qty_received < l.qty_ordered
    ) THEN 'received'::grip.purchase_order_status
    ELSE 'partial'::grip.purchase_order_status
  END
  WHERE po.id = v_po.id;

  -- Fill backorders, oldest first, on jobs that are still open.
  v_avail := v_stock.qty_on_hand + p_qty - v_stock.qty_reserved;
  FOR v_bo IN
    SELECT pl.id, pl.work_order_id, pl.qty_backordered, w.number AS wo_number
    FROM grip.work_order_part_lines pl
    JOIN grip.work_orders w ON w.id = pl.work_order_id
    WHERE pl.part_id = v_line.part_id
      AND pl.qty_backordered > 0
      AND w.status IN ('quote', 'approved', 'in_progress')
    ORDER BY pl.created_at
    FOR UPDATE OF pl
  LOOP
    EXIT WHEN v_avail <= 0;
    v_take := least(v_bo.qty_backordered, v_avail);

    UPDATE grip.part_stock
    SET qty_reserved = qty_reserved + v_take, updated_at = now()
    WHERE part_id = v_line.part_id;

    INSERT INTO grip.stock_movements
      (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
    VALUES
      (v_tenant, v_line.part_id, 'reserve', v_take, 'work_order', v_bo.work_order_id,
       p_user_id, 'backorder filled for work order ' || v_bo.wo_number);

    UPDATE grip.work_order_part_lines
    SET qty_reserved = qty_reserved + v_take, qty_backordered = qty_backordered - v_take
    WHERE id = v_bo.id;

    PERFORM grip.log_audit('part.backorder_filled', 'work_order', v_bo.work_order_id,
      jsonb_build_object('line', v_bo.id, 'sku', v_part.sku, 'description', v_part.description,
                         'qty', v_take),
      p_user_id);

    v_avail  := v_avail - v_take;
    v_filled := v_filled + v_take;
  END LOOP;

  PERFORM grip.log_audit('purchase_order.received', 'purchase_order', v_po.id,
    jsonb_build_object('sku', v_part.sku, 'qty', p_qty, 'allocated_to_jobs', v_filled),
    p_user_id);

  RETURN v_filled;
END;
$$;

-- Cancelling a draft just closes it. Cancelling a placed order takes the
-- outstanding quantity back off "on order"; if some of it had already arrived
-- the order is closed short rather than cancelled, since the receipts stand.
CREATE OR REPLACE FUNCTION grip.cancel_purchase_order(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_po       grip.purchase_orders%ROWTYPE;
  v_line     grip.purchase_order_lines%ROWTYPE;
  v_received boolean;
BEGIN
  SELECT * INTO v_po FROM grip.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'purchase order not found'; END IF;
  IF v_po.status NOT IN ('draft', 'ordered', 'partial') THEN
    RAISE EXCEPTION 'a purchase order that is % cannot be cancelled', v_po.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (SELECT 1 FROM grip.purchase_order_lines
                 WHERE purchase_order_id = p_po_id AND qty_received > 0)
  INTO v_received;

  IF v_po.status IN ('ordered', 'partial') THEN
    FOR v_line IN
      SELECT * FROM grip.purchase_order_lines
      WHERE purchase_order_id = p_po_id AND qty_received < qty_ordered
      ORDER BY part_id
    LOOP
      UPDATE grip.part_stock
      SET qty_on_order = greatest(qty_on_order - (v_line.qty_ordered - v_line.qty_received), 0),
          updated_at = now()
      WHERE part_id = v_line.part_id;
    END LOOP;
  END IF;

  UPDATE grip.purchase_orders
  SET status = CASE WHEN v_received THEN 'received'::grip.purchase_order_status
                    ELSE 'cancelled'::grip.purchase_order_status END
  WHERE id = p_po_id;

  PERFORM grip.log_audit(
    CASE WHEN v_received THEN 'purchase_order.closed_short' ELSE 'purchase_order.cancelled' END,
    'purchase_order', p_po_id, NULL);
END;
$$;

-- Builds a draft order for everything from one supplier that is running low.
-- "Low" counts what is already on order, so reordering twice does not double up.
CREATE OR REPLACE FUNCTION grip.create_reorder_po(p_supplier_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_po   uuid;
  v_part RECORD;
  v_qty  integer;
  v_n    integer := 0;
BEGIN
  FOR v_part IN
    SELECT p.id, p.reorder_point, p.reorder_qty,
           coalesce(s.qty_on_hand - s.qty_reserved, 0) + coalesce(s.qty_on_order, 0) AS position
    FROM grip.parts p
    LEFT JOIN grip.part_stock s ON s.part_id = p.id
    WHERE p.supplier_id = p_supplier_id AND p.is_active AND p.is_stocked
      AND p.reorder_point > 0
      AND coalesce(s.qty_on_hand - s.qty_reserved, 0) + coalesce(s.qty_on_order, 0) <= p.reorder_point
    ORDER BY p.sku
  LOOP
    IF v_po IS NULL THEN
      v_po := grip.create_purchase_order(p_supplier_id);
    END IF;
    v_qty := CASE WHEN v_part.reorder_qty > 0 THEN v_part.reorder_qty
                  ELSE greatest(v_part.reorder_point * 2 - v_part.position, 1) END;
    PERFORM grip.add_purchase_order_line(v_po, v_part.id, v_qty);
    v_n := v_n + 1;
  END LOOP;

  IF v_po IS NULL THEN
    RAISE EXCEPTION 'nothing from this supplier is at or below its reorder point'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_po;
END;
$$;

-- ---------------------------------------------------------------------------
-- Counter sales
-- ---------------------------------------------------------------------------
--   open -> completed        (stock leaves the moment a line is added)
--   open -> cancelled        (everything goes back on the shelf)

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
BEGIN
  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM grip.customers WHERE id = p_customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer not found'; END IF;
  END IF;

  SELECT * INTO v_settings FROM grip.tenant_settings WHERE tenant_id = v_tenant;
  v_number := grip.next_document_number('counter_sale');

  INSERT INTO grip.counter_sales
    (tenant_id, number, customer_id, customer_name, status, tax_rate_id, sold_by)
  VALUES
    (v_tenant, v_number, p_customer_id,
     coalesce(nullif(trim(p_customer_name), ''), v_customer.display_name, 'Walk-in'),
     'open',
     coalesce(v_customer.tax_rate_id, v_settings.default_tax_rate_id),
     grip.current_user_id())
  RETURNING id INTO v_id;

  PERFORM grip.log_audit('counter_sale.created', 'counter_sale', v_id,
    jsonb_build_object('number', v_number));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.assert_counter_sale_open(p_sale_id uuid)
RETURNS grip.counter_sales
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sale grip.counter_sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale FROM grip.counter_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'counter sale not found'; END IF;
  IF v_sale.status <> 'open' THEN
    RAISE EXCEPTION 'a counter sale that is % cannot be changed', v_sale.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_sale;
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
  PERFORM grip.recalculate_counter_sale(p_sale_id);
END;
$$;

-- Replaces 0004's version. A counter sale is over the counter: there is no
-- backorder (p_allow_backorder is kept for signature compatibility and
-- ignored), and the sale must still be open.
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
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM grip.assert_counter_sale_open(p_sale_id);

  SELECT * INTO v_part FROM grip.parts WHERE id = p_part_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'part % not found in this tenant', p_part_id; END IF;

  INSERT INTO grip.part_stock (part_id, tenant_id) VALUES (p_part_id, v_tenant)
  ON CONFLICT (part_id) DO NOTHING;
  SELECT * INTO v_stock FROM grip.part_stock WHERE part_id = p_part_id FOR UPDATE;

  -- Competes with work-order reservations for the same shelf.
  v_available := v_stock.qty_on_hand - v_stock.qty_reserved;
  IF p_qty > v_available THEN
    RAISE EXCEPTION 'insufficient stock for %: % available, % requested',
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
  PERFORM grip.log_audit('part.sold', 'counter_sale', p_sale_id,
    jsonb_build_object('line', v_line_id, 'sku', v_part.sku, 'description', v_part.description,
                       'qty', p_qty),
    p_user_id);
  RETURN v_line_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.remove_counter_sale_line(p_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_user   uuid := grip.current_user_id();
  v_line   grip.counter_sale_lines%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM grip.counter_sale_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'line not found'; END IF;
  PERFORM grip.assert_counter_sale_open(v_line.counter_sale_id);

  PERFORM 1 FROM grip.part_stock WHERE part_id = v_line.part_id FOR UPDATE;
  UPDATE grip.part_stock
  SET qty_on_hand = qty_on_hand + v_line.qty, updated_at = now()
  WHERE part_id = v_line.part_id;

  INSERT INTO grip.stock_movements
    (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
  VALUES
    (v_tenant, v_line.part_id, 'return', v_line.qty, 'counter_sale',
     v_line.counter_sale_id, v_user, 'line removed');

  DELETE FROM grip.counter_sale_lines WHERE id = p_line_id;
  PERFORM grip.recalculate_counter_sale(v_line.counter_sale_id);
  PERFORM grip.log_audit('part.unsold', 'counter_sale', v_line.counter_sale_id,
    jsonb_build_object('line', p_line_id, 'description', v_line.description, 'qty', v_line.qty));
END;
$$;

CREATE OR REPLACE FUNCTION grip.complete_counter_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM grip.assert_counter_sale_open(p_sale_id);
  PERFORM 1 FROM grip.counter_sale_lines WHERE counter_sale_id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'add at least one part before completing the sale'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM grip.recalculate_counter_sale(p_sale_id);
  UPDATE grip.counter_sales SET status = 'completed', completed_at = now()
  WHERE id = p_sale_id;
  PERFORM grip.log_audit('counter_sale.completed', 'counter_sale', p_sale_id, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION grip.cancel_counter_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_user   uuid := grip.current_user_id();
  v_line   grip.counter_sale_lines%ROWTYPE;
BEGIN
  PERFORM grip.assert_counter_sale_open(p_sale_id);

  FOR v_line IN
    SELECT * FROM grip.counter_sale_lines WHERE counter_sale_id = p_sale_id ORDER BY part_id
  LOOP
    PERFORM 1 FROM grip.part_stock WHERE part_id = v_line.part_id FOR UPDATE;
    UPDATE grip.part_stock
    SET qty_on_hand = qty_on_hand + v_line.qty, updated_at = now()
    WHERE part_id = v_line.part_id;

    INSERT INTO grip.stock_movements
      (tenant_id, part_id, kind, delta, ref_type, ref_id, user_id, note)
    VALUES
      (v_tenant, v_line.part_id, 'return', v_line.qty, 'counter_sale', p_sale_id, v_user,
       'sale cancelled');
  END LOOP;

  UPDATE grip.counter_sales SET status = 'cancelled' WHERE id = p_sale_id;
  PERFORM grip.log_audit('counter_sale.cancelled', 'counter_sale', p_sale_id, NULL);
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
