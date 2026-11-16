-- Ontario tax.
--
-- Grip is sold to Ontario shops, so tax stops being a build-your-own affair and
-- becomes the two things an Ontario shop actually needs: HST, and an exempt
-- option for the accounts that don't pay it.
--
-- The storage is deliberately unchanged. `tax_rates` + `tax_rate_components`
-- still back everything, and issued documents still keep their own snapshot in
-- `work_order_taxes` / `counter_sale_taxes`, so an invoice raised last year
-- shows the tax that was charged then. What changes is that every shop is
-- normalised to exactly two choices — HST and Exempt — and the only thing the
-- shop edits is the HST percentage. Keeping the component table means the rate
-- prints as its own named line ("HST 13%") exactly as before, and leaves the
-- door open if Ontario ever splits it again.

ALTER TABLE grip.tenant_settings
  ADD COLUMN IF NOT EXISTS hst_number text;

COMMENT ON COLUMN grip.tenant_settings.hst_number IS
  'CRA business number for HST, e.g. 123456789RT0001. Printed on invoices.';

-- ---------------------------------------------------------------------------
-- Normalise every existing shop to HST + Exempt
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t       record;
  v_hst   uuid;
  v_bps   integer;
BEGIN
  FOR t IN SELECT id FROM grip.tenants LOOP
    -- Pick the row that becomes HST: one already called HST, else the shop's
    -- default, else a new row. Preferring an existing "HST" first means the
    -- rename below can never collide with the per-shop unique name index.
    SELECT id INTO v_hst FROM grip.tax_rates
    WHERE tenant_id = t.id AND lower(name) = 'hst' LIMIT 1;

    IF v_hst IS NULL THEN
      SELECT id INTO v_hst FROM grip.tax_rates
      WHERE tenant_id = t.id AND is_default LIMIT 1;
    END IF;

    IF v_hst IS NULL THEN
      INSERT INTO grip.tax_rates
        (tenant_id, name, applies_to_labour, applies_to_parts, is_default, is_active)
      VALUES (t.id, 'HST', true, true, false, true)
      RETURNING id INTO v_hst;
    ELSE
      UPDATE grip.tax_rates
      SET name = 'HST', applies_to_labour = true, applies_to_parts = true,
          is_active = true, updated_at = now()
      WHERE id = v_hst;
    END IF;

    -- A shop already charging a single HST component keeps its percentage;
    -- anything else (GST + PST and friends) becomes the Ontario 13%.
    SELECT rate_bps INTO v_bps FROM grip.tax_rate_components
    WHERE tax_rate_id = v_hst AND lower(name) = 'hst'
    ORDER BY sort_order LIMIT 1;

    DELETE FROM grip.tax_rate_components WHERE tax_rate_id = v_hst;
    INSERT INTO grip.tax_rate_components (tenant_id, tax_rate_id, name, rate_bps, sort_order)
    VALUES (t.id, v_hst, 'HST', coalesce(v_bps, 1300), 0);

    -- Exempt: no components at all, and it taxes neither labour nor parts.
    IF NOT EXISTS (
      SELECT 1 FROM grip.tax_rates WHERE tenant_id = t.id AND lower(name) = 'exempt'
    ) THEN
      INSERT INTO grip.tax_rates
        (tenant_id, name, applies_to_labour, applies_to_parts, is_default, is_active)
      VALUES (t.id, 'Exempt', false, false, false, true);
    END IF;

    -- Anything else the shop had built is retired, not deleted: documents that
    -- used it keep pointing at it, it just leaves the picker.
    UPDATE grip.tax_rates
    SET is_active = false, updated_at = now()
    WHERE tenant_id = t.id AND id <> v_hst AND lower(name) <> 'exempt' AND is_active;

    -- HST is the default. Clear first, because at most one default per shop.
    UPDATE grip.tax_rates SET is_default = false
    WHERE tenant_id = t.id AND is_default AND id <> v_hst;
    UPDATE grip.tax_rates SET is_default = true
    WHERE id = v_hst AND NOT is_default;

    INSERT INTO grip.tenant_settings (tenant_id, default_tax_rate_id)
    VALUES (t.id, v_hst)
    ON CONFLICT (tenant_id) DO UPDATE SET default_tax_rate_id = v_hst, updated_at = now();
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- The one tax setting a shop owns
-- ---------------------------------------------------------------------------

-- Changing the rate affects new and still-open documents only. Issued invoices
-- and completed sales carry their own snapshot, so this can never restate what
-- a customer was already charged.
--
-- Open documents are re-priced here and now rather than whenever someone next
-- happens to touch a line. Otherwise a quote would sit on the old rate and then
-- silently jump the moment a part was added to it.
CREATE OR REPLACE FUNCTION grip.set_hst_rate(p_bps integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_id     uuid;
  v_old    integer;
  r        record;
BEGIN
  IF p_bps IS NULL OR p_bps < 0 OR p_bps > 3000 THEN
    RAISE EXCEPTION 'the HST rate must be between 0%% and 30%%'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_id FROM grip.tax_rates WHERE lower(name) = 'hst' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this shop has no HST rate' USING ERRCODE = 'P0001';
  END IF;

  SELECT rate_bps INTO v_old FROM grip.tax_rate_components
  WHERE tax_rate_id = v_id ORDER BY sort_order LIMIT 1;

  DELETE FROM grip.tax_rate_components WHERE tax_rate_id = v_id;
  INSERT INTO grip.tax_rate_components (tenant_id, tax_rate_id, name, rate_bps, sort_order)
  VALUES (v_tenant, v_id, 'HST', p_bps, 0);

  UPDATE grip.tax_rates SET updated_at = now() WHERE id = v_id;

  FOR r IN
    SELECT id FROM grip.work_orders
    WHERE tax_rate_id = v_id AND status IN ('quote', 'approved', 'in_progress')
    ORDER BY id
    FOR UPDATE
  LOOP
    PERFORM grip.recalculate_work_order(r.id);
  END LOOP;

  FOR r IN
    SELECT id FROM grip.counter_sales
    WHERE tax_rate_id = v_id AND status = 'open'
    ORDER BY id
    FOR UPDATE
  LOOP
    PERFORM grip.recalculate_counter_sale(r.id);
  END LOOP;

  PERFORM grip.log_audit('tax.hst_rate_changed', 'tax_rate', v_id,
    jsonb_build_object('from_bps', v_old, 'to_bps', p_bps));
END;
$$;

-- Gives a brand new shop the Ontario setup. Runs as the owner during seeding
-- and tenant creation, so it takes the tenant explicitly rather than reading
-- the request's tenant.
CREATE OR REPLACE FUNCTION grip.create_ontario_tax_rates(p_tenant uuid, p_bps integer DEFAULT 1300)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_hst uuid;
BEGIN
  INSERT INTO grip.tax_rates
    (tenant_id, name, applies_to_labour, applies_to_parts, is_default, is_active)
  VALUES (p_tenant, 'HST', true, true, true, true)
  RETURNING id INTO v_hst;

  INSERT INTO grip.tax_rate_components (tenant_id, tax_rate_id, name, rate_bps, sort_order)
  VALUES (p_tenant, v_hst, 'HST', p_bps, 0);

  INSERT INTO grip.tax_rates
    (tenant_id, name, applies_to_labour, applies_to_parts, is_default, is_active)
  VALUES (p_tenant, 'Exempt', false, false, false, true);

  RETURN v_hst;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
