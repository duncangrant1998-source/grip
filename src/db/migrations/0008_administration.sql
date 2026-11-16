-- Grip — 0008 — administration: staff, shifts, the time clock, tax-rate
-- management and the reporting functions.
--
-- As before, the rules live here so no front end can skip them, everything runs
-- as grip_app under row-level security, and the actor is the verified session
-- user (app.user_id), never a parameter.
--
-- Times from the shop's wall clock arrive as `timestamp` and are converted with
-- the shop's own timezone, exactly as in scheduling (0007).

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

-- Explicit, because "technician" drives labour cost and efficiency reporting and
-- must not be guessed from a job title.
ALTER TABLE grip.employees ADD COLUMN is_technician boolean NOT NULL DEFAULT false;
UPDATE grip.employees e SET is_technician = true
FROM grip.users u WHERE u.id = e.user_id AND u.role = 'technician';

-- One login belongs to at most one staff record.
CREATE UNIQUE INDEX employees_one_per_user ON grip.employees (user_id) WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION grip.create_user(
  p_email         text,
  p_full_name     text,
  p_role          grip.user_role,
  p_password_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_id     uuid;
BEGIN
  IF trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'that email address does not look right' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(trim(p_full_name), '') = '' THEN
    RAISE EXCEPTION 'a login needs a name' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(p_password_hash, '') = '' THEN
    RAISE EXCEPTION 'a login needs a password' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
  VALUES (v_tenant, lower(trim(p_email)), p_password_hash, trim(p_full_name), p_role)
  RETURNING id INTO v_id;

  PERFORM grip.log_audit('user.created', 'user', v_id,
    jsonb_build_object('email', lower(trim(p_email)), 'role', p_role));
  RETURN v_id;
END;
$$;

-- Change a login's role or switch it on and off. A shop must always keep at
-- least one active administrator, or nobody could ever manage it again. All of
-- the shop's administrators are locked first, so two admins demoting each other
-- at the same moment cannot both pass the check.
CREATE OR REPLACE FUNCTION grip.update_user_access(
  p_user_id   uuid,
  p_role      grip.user_role,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user grip.users%ROWTYPE;
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
END;
$$;

CREATE OR REPLACE FUNCTION grip.set_user_password(p_user_id uuid, p_password_hash text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(p_password_hash, '') = '' THEN
    RAISE EXCEPTION 'a password is required' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE grip.users SET password_hash = p_password_hash WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'login not found'; END IF;

  -- Whoever had the old password is signed out everywhere.
  UPDATE grip.sessions SET revoked_at = now() WHERE user_id = p_user_id AND revoked_at IS NULL;
  PERFORM grip.log_audit('user.password_reset', 'user', p_user_id, NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------

ALTER TABLE grip.shifts
  ADD CONSTRAINT shifts_no_overlap
  EXCLUDE USING gist (employee_id WITH =, tstzrange(starts_at, ends_at) WITH &&);

CREATE OR REPLACE FUNCTION grip.add_shift(
  p_employee_id uuid,
  p_start_local timestamp,
  p_end_local   timestamp,
  p_note        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_tz     text := grip.shop_timezone();
  v_start  timestamptz := p_start_local AT TIME ZONE v_tz;
  v_end    timestamptz := p_end_local   AT TIME ZONE v_tz;
  v_id     uuid;
  v_hit    RECORD;
BEGIN
  IF v_end <= v_start THEN
    RAISE EXCEPTION 'a shift must end after it starts' USING ERRCODE = 'check_violation';
  END IF;
  IF v_end - v_start > interval '24 hours' THEN
    RAISE EXCEPTION 'a shift cannot be longer than 24 hours' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM grip.employees WHERE id = p_employee_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff member not found'; END IF;

  SELECT s.starts_at, s.ends_at, e.full_name INTO v_hit
  FROM grip.shifts s JOIN grip.employees e ON e.id = s.employee_id
  WHERE s.employee_id = p_employee_id AND tstzrange(s.starts_at, s.ends_at) && tstzrange(v_start, v_end)
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% already has a shift % – %', v_hit.full_name,
      to_char(v_hit.starts_at AT TIME ZONE v_tz, 'FMHH12:MI AM'),
      to_char(v_hit.ends_at   AT TIME ZONE v_tz, 'FMHH12:MI AM')
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO grip.shifts (tenant_id, employee_id, starts_at, ends_at, note)
  VALUES (v_tenant, p_employee_id, v_start, v_end, nullif(trim(p_note), ''))
  RETURNING id INTO v_id;
  PERFORM grip.log_audit('shift.added', 'employee', p_employee_id,
    jsonb_build_object('starts_at', v_start, 'ends_at', v_end));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.delete_shift(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_shift grip.shifts%ROWTYPE;
BEGIN
  DELETE FROM grip.shifts WHERE id = p_shift_id RETURNING * INTO v_shift;
  IF NOT FOUND THEN RAISE EXCEPTION 'shift not found'; END IF;
  PERFORM grip.log_audit('shift.removed', 'employee', v_shift.employee_id,
    jsonb_build_object('starts_at', v_shift.starts_at, 'ends_at', v_shift.ends_at));
END;
$$;

-- ---------------------------------------------------------------------------
-- The time clock
-- ---------------------------------------------------------------------------

-- An open entry has no clock_out, i.e. an unbounded range, so this one
-- constraint also guarantees a person is never clocked in twice.
ALTER TABLE grip.time_entries
  ADD CONSTRAINT time_entries_no_overlap
  EXCLUDE USING gist (employee_id WITH =, tstzrange(clock_in, clock_out) WITH &&);

CREATE OR REPLACE FUNCTION grip.my_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT id FROM grip.employees
  WHERE user_id = grip.current_user_id() AND is_active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION grip.clock_in(p_work_order_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_emp    uuid := grip.my_employee_id();
  v_status grip.work_order_status;
  v_id     uuid;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'your login is not linked to a staff record — ask an administrator'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM grip.time_entries WHERE employee_id = v_emp AND clock_out IS NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'you are already clocked in' USING ERRCODE = 'check_violation';
  END IF;

  IF p_work_order_id IS NOT NULL THEN
    SELECT status INTO v_status FROM grip.work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
    IF v_status NOT IN ('quote', 'approved', 'in_progress') THEN
      RAISE EXCEPTION 'you can only clock onto an open work order'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO grip.time_entries (tenant_id, employee_id, work_order_id, clock_in)
  VALUES (v_tenant, v_emp, p_work_order_id, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Returns the minutes just worked.
CREATE OR REPLACE FUNCTION grip.clock_out()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_emp   uuid := grip.my_employee_id();
  v_entry grip.time_entries%ROWTYPE;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'your login is not linked to a staff record — ask an administrator'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.time_entries
  SET clock_out = greatest(now(), clock_in + interval '1 second')
  WHERE employee_id = v_emp AND clock_out IS NULL
  RETURNING * INTO v_entry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'you are not clocked in' USING ERRCODE = 'check_violation';
  END IF;

  RETURN (extract(epoch FROM v_entry.clock_out - v_entry.clock_in) / 60)::int;
END;
$$;

-- Administrator corrections: forgot to clock out, forgot to clock in, wrong day.
-- p_id NULL adds an entry; otherwise edits it. Every change is on the audit log.
CREATE OR REPLACE FUNCTION grip.save_time_entry(
  p_id          uuid,
  p_employee_id uuid,
  p_in_local    timestamp,
  p_out_local   timestamp,
  p_note        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_tz     text := grip.shop_timezone();
  v_in     timestamptz := p_in_local AT TIME ZONE v_tz;
  v_out    timestamptz := p_out_local AT TIME ZONE v_tz;
  v_old    grip.time_entries%ROWTYPE;
  v_id     uuid;
BEGIN
  IF v_out IS NOT NULL AND v_out <= v_in THEN
    RAISE EXCEPTION 'clock-out must be after clock-in' USING ERRCODE = 'check_violation';
  END IF;
  IF v_out IS NOT NULL AND v_out - v_in > interval '24 hours' THEN
    RAISE EXCEPTION 'an entry cannot be longer than 24 hours' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM grip.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff member not found'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO grip.time_entries (tenant_id, employee_id, clock_in, clock_out, note)
    VALUES (v_tenant, p_employee_id, v_in, v_out, nullif(trim(p_note), ''))
    RETURNING id INTO v_id;
    PERFORM grip.log_audit('time.added', 'employee', p_employee_id,
      jsonb_build_object('clock_in', v_in, 'clock_out', v_out));
  ELSE
    SELECT * INTO v_old FROM grip.time_entries WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'time entry not found'; END IF;
    UPDATE grip.time_entries
    SET clock_in = v_in, clock_out = v_out, note = nullif(trim(p_note), '')
    WHERE id = p_id;
    v_id := p_id;
    PERFORM grip.log_audit('time.edited', 'employee', v_old.employee_id,
      jsonb_build_object('from_in', v_old.clock_in, 'from_out', v_old.clock_out,
                         'to_in', v_in, 'to_out', v_out));
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.delete_time_entry(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_old grip.time_entries%ROWTYPE;
BEGIN
  DELETE FROM grip.time_entries WHERE id = p_id RETURNING * INTO v_old;
  IF NOT FOUND THEN RAISE EXCEPTION 'time entry not found'; END IF;
  PERFORM grip.log_audit('time.removed', 'employee', v_old.employee_id,
    jsonb_build_object('clock_in', v_old.clock_in, 'clock_out', v_old.clock_out));
END;
$$;

-- ---------------------------------------------------------------------------
-- Tax rates
-- ---------------------------------------------------------------------------
-- Editing a rate never touches an issued document: invoices store the tax as
-- charged (work_order_taxes). So components can be replaced freely here.

CREATE OR REPLACE FUNCTION grip.save_tax_rate(
  p_id         uuid,
  p_name       text,
  p_on_labour  boolean,
  p_on_parts   boolean,
  p_components jsonb       -- [{"name": "GST", "rate_bps": 500}, ...]
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_id     uuid := p_id;
  v_c      jsonb;
  v_i      integer := 0;
  v_first  boolean;
BEGIN
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'a tax rate needs a name' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(p_components) <> 'array' OR jsonb_array_length(p_components) > 8 THEN
    RAISE EXCEPTION 'a tax rate has between 0 and 8 components' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(p_components) LOOP
    IF coalesce(trim(v_c->>'name'), '') = '' THEN
      RAISE EXCEPTION 'every tax component needs a name' USING ERRCODE = 'check_violation';
    END IF;
    IF (v_c->>'rate_bps')::integer < 0 OR (v_c->>'rate_bps')::integer > 100000 THEN
      RAISE EXCEPTION 'a tax component must be between 0%% and 1000%%' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  IF v_id IS NULL THEN
    SELECT NOT EXISTS (SELECT 1 FROM grip.tax_rates) INTO v_first;
    INSERT INTO grip.tax_rates (tenant_id, name, applies_to_labour, applies_to_parts, is_default)
    VALUES (v_tenant, trim(p_name), p_on_labour, p_on_parts, false)
    RETURNING id INTO v_id;
    PERFORM grip.log_audit('tax_rate.created', 'tax_rate', v_id, jsonb_build_object('name', trim(p_name)));
    IF v_first THEN PERFORM grip.set_default_tax_rate(v_id); END IF;
  ELSE
    PERFORM 1 FROM grip.tax_rates WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'tax rate not found'; END IF;
    UPDATE grip.tax_rates
    SET name = trim(p_name), applies_to_labour = p_on_labour, applies_to_parts = p_on_parts
    WHERE id = v_id;
    DELETE FROM grip.tax_rate_components WHERE tax_rate_id = v_id;
    PERFORM grip.log_audit('tax_rate.updated', 'tax_rate', v_id, jsonb_build_object('name', trim(p_name)));
  END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(p_components) LOOP
    INSERT INTO grip.tax_rate_components (tenant_id, tax_rate_id, name, rate_bps, sort_order)
    VALUES (v_tenant, v_id, trim(v_c->>'name'), (v_c->>'rate_bps')::integer, v_i);
    v_i := v_i + 1;
  END LOOP;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.set_default_tax_rate(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
BEGIN
  PERFORM 1 FROM grip.tax_rates WHERE id = p_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'tax rate not found'; END IF;

  -- The unique index allows one default per shop, so clear before setting.
  UPDATE grip.tax_rates SET is_default = false WHERE tenant_id = v_tenant AND is_default;
  UPDATE grip.tax_rates SET is_default = true WHERE id = p_id;

  INSERT INTO grip.tenant_settings (tenant_id, default_tax_rate_id)
  VALUES (v_tenant, p_id)
  ON CONFLICT (tenant_id) DO UPDATE SET default_tax_rate_id = p_id, updated_at = now();

  PERFORM grip.log_audit('tax_rate.made_default', 'tax_rate', p_id, NULL);
END;
$$;

-- Old documents point at a rate, so a rate is retired rather than deleted, and
-- the shop default can never be retired out from under new work orders.
CREATE OR REPLACE FUNCTION grip.set_tax_rate_active(p_id uuid, p_active boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_rate grip.tax_rates%ROWTYPE;
BEGIN
  SELECT * INTO v_rate FROM grip.tax_rates WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tax rate not found'; END IF;
  IF NOT p_active AND v_rate.is_default THEN
    RAISE EXCEPTION 'make another rate the default before retiring this one'
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE grip.tax_rates SET is_active = p_active WHERE id = p_id;
  PERFORM grip.log_audit(CASE WHEN p_active THEN 'tax_rate.restored' ELSE 'tax_rate.retired' END,
    'tax_rate', p_id, NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------
-- Revenue is recognised when a work order is INVOICED and when a counter sale is
-- COMPLETED, bucketed by the shop's local date. Tax is reported separately and
-- is never part of revenue. Cancelled and unfinished work counts for nothing.

CREATE OR REPLACE FUNCTION grip.report_revenue(p_from date, p_to date, p_grain text)
RETURNS TABLE (
  period       text,
  labour       numeric,
  parts        numeric,
  tax          numeric,
  parts_cost   numeric,
  billed_hours numeric,
  documents    bigint
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH tz AS (SELECT grip.shop_timezone() AS z),
  rng AS (
    SELECT (p_from::timestamp AT TIME ZONE tz.z) AS lo,
           (p_to::timestamp   AT TIME ZONE tz.z) AS hi, tz.z
    FROM tz
  ),
  docs AS (
    SELECT w.invoiced_at AT TIME ZONE rng.z AS local_ts,
           w.labour_subtotal AS labour, w.parts_subtotal AS parts, w.tax_total AS tax,
           coalesce((SELECT sum(l.qty * l.unit_cost) FROM grip.work_order_part_lines l
                     WHERE l.work_order_id = w.id), 0) AS parts_cost,
           coalesce((SELECT sum(l.billed_hours) FROM grip.work_order_labour_lines l
                     WHERE l.work_order_id = w.id), 0) AS billed_hours
    FROM grip.work_orders w, rng
    WHERE w.status IN ('invoiced', 'paid')
      AND w.invoiced_at >= rng.lo AND w.invoiced_at < rng.hi
    UNION ALL
    SELECT s.completed_at AT TIME ZONE rng.z, 0, s.subtotal, s.tax_total,
           coalesce((SELECT sum(l.qty * l.unit_cost) FROM grip.counter_sale_lines l
                     WHERE l.counter_sale_id = s.id), 0), 0
    FROM grip.counter_sales s, rng
    WHERE s.status = 'completed'
      AND s.completed_at >= rng.lo AND s.completed_at < rng.hi
  )
  SELECT
    CASE p_grain
      WHEN 'month' THEN to_char(date_trunc('month', local_ts), 'YYYY-MM-DD')
      WHEN 'week'  THEN to_char(date_trunc('week',  local_ts), 'YYYY-MM-DD')
      ELSE              to_char(local_ts, 'YYYY-MM-DD')
    END AS period,
    sum(labour), sum(parts), sum(tax), sum(parts_cost), sum(billed_hours), count(*)
  FROM docs
  GROUP BY 1
  ORDER BY 1;
$$;

-- What the technicians cost for the hours they were on the clock.
CREATE OR REPLACE FUNCTION grip.report_labour_cost(p_from date, p_to date, p_grain text)
RETURNS TABLE (period text, clocked_hours numeric, payroll_cost numeric)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH tz AS (SELECT grip.shop_timezone() AS z),
  rng AS (
    SELECT (p_from::timestamp AT TIME ZONE tz.z) AS lo,
           (p_to::timestamp   AT TIME ZONE tz.z) AS hi, tz.z
    FROM tz
  )
  SELECT
    CASE p_grain
      WHEN 'month' THEN to_char(date_trunc('month', t.clock_in AT TIME ZONE rng.z), 'YYYY-MM-DD')
      WHEN 'week'  THEN to_char(date_trunc('week',  t.clock_in AT TIME ZONE rng.z), 'YYYY-MM-DD')
      ELSE              to_char(t.clock_in AT TIME ZONE rng.z, 'YYYY-MM-DD')
    END AS period,
    round(sum(extract(epoch FROM t.clock_out - t.clock_in) / 3600.0)::numeric, 2),
    round(sum(extract(epoch FROM t.clock_out - t.clock_in) / 3600.0 * e.hourly_rate)::numeric, 2)
  FROM grip.time_entries t
  JOIN grip.employees e ON e.id = t.employee_id AND e.is_technician
  CROSS JOIN rng
  WHERE t.clock_out IS NOT NULL AND t.clock_in >= rng.lo AND t.clock_in < rng.hi
  GROUP BY 1
  ORDER BY 1;
$$;

-- Per technician. Two different ratios, because they answer different questions:
--   efficiency   = billed hours / actual hours on the jobs  (am I quicker than book time?)
--   productivity = billed hours / hours on the clock        (how much of the day is billed?)
-- Straight-time lines have billed = actual, so they read 100% by construction.
CREATE OR REPLACE FUNCTION grip.report_technicians(p_from date, p_to date)
RETURNS TABLE (
  employee_id    uuid,
  full_name      text,
  hourly_rate    numeric,
  billed_hours   numeric,
  actual_hours   numeric,
  labour_revenue numeric,
  clocked_hours  numeric,
  payroll_cost   numeric
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH tz AS (SELECT grip.shop_timezone() AS z),
  rng AS (
    SELECT (p_from::timestamp AT TIME ZONE tz.z) AS lo,
           (p_to::timestamp   AT TIME ZONE tz.z) AS hi
    FROM tz
  ),
  jobs AS (
    SELECT l.tech_id,
           sum(l.billed_hours) AS billed, sum(l.actual_hours) AS actual,
           sum(l.billed_hours * l.rate) AS revenue
    FROM grip.work_order_labour_lines l
    JOIN grip.work_orders w ON w.id = l.work_order_id
    CROSS JOIN rng
    WHERE w.status IN ('invoiced', 'paid') AND w.invoiced_at >= rng.lo AND w.invoiced_at < rng.hi
      AND l.tech_id IS NOT NULL
    GROUP BY l.tech_id
  ),
  clock AS (
    SELECT t.employee_id,
           sum(extract(epoch FROM t.clock_out - t.clock_in) / 3600.0) AS hrs
    FROM grip.time_entries t CROSS JOIN rng
    WHERE t.clock_out IS NOT NULL AND t.clock_in >= rng.lo AND t.clock_in < rng.hi
    GROUP BY t.employee_id
  )
  SELECT e.id, e.full_name, e.hourly_rate,
         coalesce(j.billed, 0), coalesce(j.actual, 0), coalesce(j.revenue, 0),
         round(coalesce(c.hrs, 0)::numeric, 2),
         round((coalesce(c.hrs, 0) * e.hourly_rate)::numeric, 2)
  FROM grip.employees e
  LEFT JOIN jobs j ON j.tech_id = e.id
  LEFT JOIN clock c ON c.employee_id = e.id
  WHERE e.is_technician AND (e.is_active OR j.tech_id IS NOT NULL OR c.employee_id IS NOT NULL)
  ORDER BY e.full_name;
$$;

-- A look ahead, with the method deliberately simple and stated on the page:
-- month-to-date revenue plus the trailing 28-day daily average for the days
-- left, alongside the work already in the building and the hours already booked.
CREATE OR REPLACE FUNCTION grip.report_projection()
RETURNS TABLE (
  today            date,
  month_start      date,
  mtd_revenue      numeric,
  trailing_28      numeric,
  avg_daily        numeric,
  days_remaining   integer,
  projected_month  numeric,
  wip_orders       bigint,
  wip_value        numeric,
  quote_orders     bigint,
  quote_value      numeric,
  booked_hours_7d  numeric
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_tz       text := grip.shop_timezone();
  v_today    date := (now() AT TIME ZONE grip.shop_timezone())::date;
  v_mstart   date := date_trunc('month', (now() AT TIME ZONE grip.shop_timezone()))::date;
  v_mend     date := (date_trunc('month', (now() AT TIME ZONE grip.shop_timezone())) + interval '1 month')::date;
  v_tom      timestamptz := ((v_today + 1)::timestamp AT TIME ZONE v_tz);
  v_mtd      numeric;
  v_t28      numeric;
BEGIN
  SELECT coalesce(sum(labour + parts), 0) INTO v_mtd
  FROM grip.report_revenue(v_mstart, v_today + 1, 'day');

  SELECT coalesce(sum(labour + parts), 0) INTO v_t28
  FROM grip.report_revenue(v_today - 27, v_today + 1, 'day');

  today := v_today;
  month_start := v_mstart;
  mtd_revenue := v_mtd;
  trailing_28 := v_t28;
  avg_daily := round(v_t28 / 28.0, 2);
  days_remaining := (v_mend - (v_today + 1));
  projected_month := round(v_mtd + (v_t28 / 28.0) * (v_mend - (v_today + 1)), 2);

  SELECT count(*), coalesce(sum(subtotal), 0) INTO wip_orders, wip_value
  FROM grip.work_orders WHERE status IN ('approved', 'in_progress', 'completed');

  SELECT count(*), coalesce(sum(subtotal), 0) INTO quote_orders, quote_value
  FROM grip.work_orders WHERE status = 'quote';

  SELECT coalesce(sum(estimated_minutes), 0) / 60.0 INTO booked_hours_7d
  FROM grip.appointments
  WHERE status IN ('scheduled', 'confirmed', 'arrived', 'in_progress')
    AND starts_at >= v_today::timestamp AT TIME ZONE v_tz
    AND starts_at <  (v_today + 7)::timestamp AT TIME ZONE v_tz;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
