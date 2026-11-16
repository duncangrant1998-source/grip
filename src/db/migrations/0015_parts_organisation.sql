-- Parts: organised, supplied, and taxed line by line.
--
--   * parts get a sub-category under their category
--   * suppliers carry an address, hours of operation and delivery information,
--     so the parts desk knows when a truck is coming without phoning
--   * a counter sale's customer can be changed once the sale has started
--   * tax can be switched off (or back on) for a single part line, on a work
--     order or a counter sale

ALTER TABLE grip.parts
  ADD COLUMN IF NOT EXISTS subcategory text;

CREATE INDEX IF NOT EXISTS parts_category_idx
  ON grip.parts (tenant_id, category, subcategory) WHERE is_active;

ALTER TABLE grip.suppliers
  ADD COLUMN IF NOT EXISTS address_line1  text,
  ADD COLUMN IF NOT EXISTS city           text,
  ADD COLUMN IF NOT EXISTS region         text,
  ADD COLUMN IF NOT EXISTS postal_code    text,
  -- Free text on purpose: "Mon–Fri 7:30–5, Sat 8–12" is how a supplier says it,
  -- and a structured week of open/close times would be wrong for half of them.
  ADD COLUMN IF NOT EXISTS hours          text,
  ADD COLUMN IF NOT EXISTS delivery_notes text;

-- ---------------------------------------------------------------------------
-- Tax by part line
-- ---------------------------------------------------------------------------

-- A part line on a work order. Parts stop being editable at "completed" (that is
-- when they are used up), so the tax on them closes then too.
CREATE OR REPLACE FUNCTION grip.set_part_line_taxable(p_line_id uuid, p_taxable boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user uuid := grip.current_user_id();
  v_line grip.work_order_part_lines%ROWTYPE;
  v_wo   grip.work_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM grip.work_order_part_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'part line not found'; END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = v_line.work_order_id FOR UPDATE;
  PERFORM grip.assert_work_order_editable(v_wo.status);

  IF v_line.is_taxable = p_taxable THEN RETURN; END IF;

  UPDATE grip.work_order_part_lines
  SET is_taxable = p_taxable, edited_by_user_id = v_user, edited_at = now(), updated_at = now()
  WHERE id = p_line_id;

  PERFORM grip.recalculate_work_order(v_line.work_order_id);
  PERFORM grip.log_audit('part.tax_changed', 'work_order', v_line.work_order_id,
    jsonb_build_object('line', p_line_id, 'description', v_line.description, 'taxable', p_taxable));
END;
$$;

CREATE OR REPLACE FUNCTION grip.set_counter_sale_line_taxable(p_line_id uuid, p_taxable boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_line grip.counter_sale_lines%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM grip.counter_sale_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale line not found'; END IF;

  PERFORM grip.assert_counter_sale_open(v_line.counter_sale_id);
  IF v_line.is_taxable = p_taxable THEN RETURN; END IF;

  UPDATE grip.counter_sale_lines SET is_taxable = p_taxable WHERE id = p_line_id;
  PERFORM grip.recalculate_counter_sale(v_line.counter_sale_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Changing a counter sale's customer
-- ---------------------------------------------------------------------------

-- A customer on file, or just a name for a walk-in. Moving to a customer takes on
-- their tax arrangement exactly as starting a sale for them would, and moving
-- back to a plain walk-in returns to the shop's normal rate.
CREATE OR REPLACE FUNCTION grip.set_counter_sale_customer(
  p_sale_id       uuid,
  p_customer_id   uuid,
  p_customer_name text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant   uuid := grip.current_tenant_id();
  v_sale     grip.counter_sales%ROWTYPE;
  v_customer grip.customers%ROWTYPE;
  v_settings grip.tenant_settings%ROWTYPE;
  v_rate     uuid;
  v_live     boolean := false;
BEGIN
  PERFORM grip.assert_counter_sale_open(p_sale_id);
  SELECT * INTO v_sale FROM grip.counter_sales WHERE id = p_sale_id FOR UPDATE;

  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer FROM grip.customers WHERE id = p_customer_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer not found'; END IF;
    v_live := grip.customer_exemption_live(p_customer_id);
  END IF;

  SELECT * INTO v_settings FROM grip.tenant_settings WHERE tenant_id = v_tenant;

  IF p_customer_id IS DISTINCT FROM v_sale.customer_id THEN
    v_rate := coalesce(v_customer.tax_rate_id, v_settings.default_tax_rate_id);
    UPDATE grip.counter_sales
    SET customer_id = p_customer_id,
        tax_rate_id = v_rate,
        exempt_reason = CASE WHEN grip.rate_is_exempt(v_rate) AND v_live THEN v_customer.exempt_reason END,
        exempt_reference = CASE WHEN grip.rate_is_exempt(v_rate) AND v_live THEN v_customer.exempt_reference END
    WHERE id = p_sale_id;
  END IF;

  UPDATE grip.counter_sales
  SET customer_name = coalesce(nullif(trim(coalesce(p_customer_name, '')), ''),
                               v_customer.display_name, 'Walk-in')
  WHERE id = p_sale_id;

  PERFORM grip.recalculate_counter_sale(p_sale_id);
  PERFORM grip.log_audit('counter_sale.customer_changed', 'counter_sale', p_sale_id,
    jsonb_build_object('customer', coalesce(v_customer.display_name, nullif(trim(coalesce(p_customer_name, '')), ''), 'Walk-in')));
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
