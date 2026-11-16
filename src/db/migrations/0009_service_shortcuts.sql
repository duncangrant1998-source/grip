-- Service shortcuts: a short code (LOF, BRK-F…) that drops a saved bundle of
-- labour and/or parts onto a work order in one go.
--
-- A shortcut can hold labour only, parts only, or both. Labour lines carry
-- hours and, optionally, their own rate and billing mode; left empty they take
-- the shop's rate and the order's mode at the moment the shortcut is applied.
-- Parts are looked up live, so applying a shortcut reserves stock and bills at
-- today's price, not the price when the shortcut was saved.

CREATE TABLE grip.service_shortcuts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  code       text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,11}$'),
  name       text NOT NULL CHECK (length(trim(name)) > 0),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX service_shortcuts_tenant_code_key ON grip.service_shortcuts (tenant_id, code);

CREATE TABLE grip.service_shortcut_labour (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  shortcut_id  uuid NOT NULL REFERENCES grip.service_shortcuts(id) ON DELETE CASCADE,
  description  text NOT NULL CHECK (length(trim(description)) > 0),
  hours        numeric(6,2) NOT NULL CHECK (hours >= 0),
  rate         numeric(10,2) CHECK (rate >= 0),
  billing_mode grip.labour_billing_mode,
  is_taxable   boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0
);
CREATE INDEX service_shortcut_labour_shortcut_idx ON grip.service_shortcut_labour (shortcut_id);

CREATE TABLE grip.service_shortcut_parts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  shortcut_id uuid NOT NULL REFERENCES grip.service_shortcuts(id) ON DELETE CASCADE,
  part_id     uuid NOT NULL REFERENCES grip.parts(id) ON DELETE CASCADE,
  qty         integer NOT NULL CHECK (qty > 0),
  sort_order  integer NOT NULL DEFAULT 0,
  UNIQUE (shortcut_id, part_id)
);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_shortcuts', 'service_shortcut_labour', 'service_shortcut_parts']
  LOOP
    EXECUTE format('ALTER TABLE grip.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON grip.%I
         FOR ALL TO grip_app
         USING (grip.tenant_visible(tenant_id))
         WITH CHECK (grip.tenant_visible(tenant_id))',
      t || '_tenant_isolation', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON grip.%I TO grip_app', t);
  END LOOP;
END $$;

-- Applies a shortcut to a work order. The caller says which halves it may add
-- (a parts advisor cannot add labour; a technician cannot add parts), so the
-- permission matrix stays in the application and the arithmetic stays here.
-- Parts that are out of stock go on backorder rather than blocking the rest of
-- the bundle; the work order already flags backordered lines.
CREATE OR REPLACE FUNCTION grip.apply_service_shortcut(
  p_work_order_id uuid,
  p_code          text,
  p_tech_id       uuid,
  p_labour        boolean,
  p_parts         boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sc          grip.service_shortcuts%ROWTYPE;
  v_wo          grip.work_orders%ROWTYPE;
  r             record;
  v_line        uuid;
  v_labour      integer := 0;
  v_parts       integer := 0;
  v_backordered integer := 0;
  v_bo          integer;
BEGIN
  SELECT * INTO v_sc FROM grip.service_shortcuts
  WHERE code = upper(trim(coalesce(p_code, ''))) AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No shortcut with the code "%".', upper(trim(coalesce(p_code, '')))
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_wo FROM grip.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  PERFORM grip.assert_work_order_editable(v_wo.status);

  IF p_labour THEN
    FOR r IN SELECT * FROM grip.service_shortcut_labour
             WHERE shortcut_id = v_sc.id ORDER BY sort_order, id
    LOOP
      PERFORM grip.add_labour_line(p_work_order_id, r.description, r.hours, NULL,
                                   r.rate, r.billing_mode, p_tech_id, r.is_taxable);
      v_labour := v_labour + 1;
    END LOOP;
  END IF;

  IF p_parts THEN
    FOR r IN SELECT * FROM grip.service_shortcut_parts
             WHERE shortcut_id = v_sc.id ORDER BY sort_order, id
    LOOP
      v_line := grip.add_part_to_work_order(p_work_order_id, r.part_id, r.qty,
                                            grip.current_user_id(), true);
      SELECT qty_backordered INTO v_bo FROM grip.work_order_part_lines WHERE id = v_line;
      v_backordered := v_backordered + coalesce(v_bo, 0);
      v_parts := v_parts + 1;
    END LOOP;
  END IF;

  IF v_labour + v_parts = 0 THEN
    RAISE EXCEPTION 'Nothing on "%" can be added by your role, or it is empty.', v_sc.code
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM grip.log_audit('shortcut.applied', 'work_order', p_work_order_id,
    jsonb_build_object('code', v_sc.code, 'name', v_sc.name,
                       'labour', v_labour, 'parts', v_parts, 'backordered', v_backordered));

  RETURN jsonb_build_object('name', v_sc.name, 'labour', v_labour,
                            'parts', v_parts, 'backordered', v_backordered);
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
