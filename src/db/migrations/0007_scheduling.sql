-- Grip — 0007 — scheduling.
--
-- The property that matters: a bay or a technician can never be in two places
-- at once. That is enforced by exclusion constraints, not by application code
-- checking first — two advisors booking the same bay at the same instant
-- cannot both succeed, because Postgres refuses the second insert.
--
-- Times are stored as timestamptz (an absolute instant) and converted to and
-- from the SHOP's timezone in SQL, so "9:00" always means 9:00 at the shop
-- regardless of where the server or the user's browser happens to be.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Shop settings the calendar needs
-- ---------------------------------------------------------------------------

ALTER TABLE grip.tenant_settings
  ADD COLUMN timezone   text    NOT NULL DEFAULT 'America/Vancouver',
  ADD COLUMN open_hour  integer NOT NULL DEFAULT 7  CHECK (open_hour  BETWEEN 0 AND 23),
  ADD COLUMN close_hour integer NOT NULL DEFAULT 18 CHECK (close_hour BETWEEN 1 AND 24),
  ADD CONSTRAINT tenant_settings_hours_check CHECK (close_hour > open_hour);

CREATE OR REPLACE FUNCTION grip.shop_timezone()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT timezone FROM grip.tenant_settings WHERE tenant_id = grip.current_tenant_id()),
    'America/Vancouver');
$$;

-- ---------------------------------------------------------------------------
-- Appointments: an explicit end, and the no-double-booking constraints
-- ---------------------------------------------------------------------------

ALTER TABLE grip.appointments ADD COLUMN ends_at timestamptz;
UPDATE grip.appointments SET ends_at = starts_at + estimated_minutes * interval '1 minute';
ALTER TABLE grip.appointments ALTER COLUMN ends_at SET NOT NULL;

-- A stored column (kept in step by a trigger) rather than an expression, because
-- an exclusion constraint needs an immutable expression and timestamptz + interval
-- is only "stable" to the planner.
CREATE OR REPLACE FUNCTION grip.set_appointment_end()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.ends_at := NEW.starts_at + NEW.estimated_minutes * interval '1 minute';
  RETURN NEW;
END;
$$;

CREATE TRIGGER appointments_set_end
  BEFORE INSERT OR UPDATE OF starts_at, estimated_minutes ON grip.appointments
  FOR EACH ROW EXECUTE FUNCTION grip.set_appointment_end();

-- Only live appointments occupy a slot. Cancelled and no-show ones free it, and
-- completed ones are history. tstzrange is half-open, so one job ending at 10:00
-- and the next starting at 10:00 do not conflict.
ALTER TABLE grip.appointments
  ADD CONSTRAINT appointments_no_bay_overlap
  EXCLUDE USING gist (bay_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (bay_id IS NOT NULL AND status IN ('scheduled', 'confirmed', 'arrived', 'in_progress'));

ALTER TABLE grip.appointments
  ADD CONSTRAINT appointments_no_tech_overlap
  EXCLUDE USING gist (assigned_tech_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (assigned_tech_id IS NOT NULL AND status IN ('scheduled', 'confirmed', 'arrived', 'in_progress'));

CREATE INDEX appointments_tenant_range_idx ON grip.appointments (tenant_id, starts_at, ends_at);

-- An appointment becomes at most one work order.
CREATE UNIQUE INDEX work_orders_one_per_appointment
  ON grip.work_orders (appointment_id) WHERE appointment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Friendly conflict message (the constraint is the guarantee; this is the manners)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.assert_slot_free(
  p_bay_id    uuid,
  p_tech_id   uuid,
  p_start     timestamptz,
  p_end       timestamptz,
  p_exclude   uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_tz   text := grip.shop_timezone();
  v_hit  RECORD;
BEGIN
  IF p_bay_id IS NOT NULL THEN
    SELECT a.starts_at, a.ends_at, c.display_name, b.name AS bay_name INTO v_hit
    FROM grip.appointments a
    JOIN grip.customers c ON c.id = a.customer_id
    JOIN grip.bays b ON b.id = a.bay_id
    WHERE a.bay_id = p_bay_id
      AND a.id IS DISTINCT FROM p_exclude
      AND a.status IN ('scheduled', 'confirmed', 'arrived', 'in_progress')
      AND tstzrange(a.starts_at, a.ends_at) && tstzrange(p_start, p_end)
    ORDER BY a.starts_at LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION '% is already booked % – % (%)', v_hit.bay_name,
        to_char(v_hit.starts_at AT TIME ZONE v_tz, 'FMHH12:MI AM'),
        to_char(v_hit.ends_at   AT TIME ZONE v_tz, 'FMHH12:MI AM'), v_hit.display_name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF p_tech_id IS NOT NULL THEN
    SELECT a.starts_at, a.ends_at, c.display_name, e.full_name AS tech_name INTO v_hit
    FROM grip.appointments a
    JOIN grip.customers c ON c.id = a.customer_id
    JOIN grip.employees e ON e.id = a.assigned_tech_id
    WHERE a.assigned_tech_id = p_tech_id
      AND a.id IS DISTINCT FROM p_exclude
      AND a.status IN ('scheduled', 'confirmed', 'arrived', 'in_progress')
      AND tstzrange(a.starts_at, a.ends_at) && tstzrange(p_start, p_end)
    ORDER BY a.starts_at LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION '% is already booked % – % (%)', v_hit.tech_name,
        to_char(v_hit.starts_at AT TIME ZONE v_tz, 'FMHH12:MI AM'),
        to_char(v_hit.ends_at   AT TIME ZONE v_tz, 'FMHH12:MI AM'), v_hit.display_name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Booking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.create_appointment(
  p_customer_id  uuid,
  p_vehicle_id   uuid,
  p_starts_local timestamp,          -- wall-clock time at the shop
  p_minutes      integer,
  p_bay_id       uuid DEFAULT NULL,
  p_tech_id      uuid DEFAULT NULL,
  p_concern      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_tz     text := grip.shop_timezone();
  v_start  timestamptz;
  v_end    timestamptz;
  v_id     uuid;
BEGIN
  IF p_minutes IS NULL OR p_minutes < 5 OR p_minutes > 1440 THEN
    RAISE EXCEPTION 'estimated time must be between 5 minutes and 24 hours'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM grip.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer not found'; END IF;

  PERFORM 1 FROM grip.vehicles WHERE id = p_vehicle_id AND customer_id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'that vehicle does not belong to this customer'; END IF;

  IF p_bay_id IS NOT NULL THEN
    PERFORM 1 FROM grip.bays WHERE id = p_bay_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'bay not found'; END IF;
  END IF;

  IF p_tech_id IS NOT NULL THEN
    PERFORM 1 FROM grip.employees WHERE id = p_tech_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'technician not found'; END IF;
  END IF;

  v_start := p_starts_local AT TIME ZONE v_tz;
  v_end   := v_start + p_minutes * interval '1 minute';

  PERFORM grip.assert_slot_free(p_bay_id, p_tech_id, v_start, v_end);

  INSERT INTO grip.appointments
    (tenant_id, customer_id, vehicle_id, bay_id, assigned_tech_id, starts_at,
     estimated_minutes, status, concern, created_by)
  VALUES
    (v_tenant, p_customer_id, p_vehicle_id, p_bay_id, p_tech_id, v_start,
     p_minutes, 'scheduled', nullif(trim(p_concern), ''), grip.current_user_id())
  RETURNING id INTO v_id;

  PERFORM grip.log_audit('appointment.created', 'appointment', v_id,
    jsonb_build_object('starts_at', v_start, 'minutes', p_minutes));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION grip.update_appointment(
  p_id           uuid,
  p_starts_local timestamp,
  p_minutes      integer,
  p_bay_id       uuid,
  p_tech_id      uuid,
  p_concern      text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tz    text := grip.shop_timezone();
  v_appt  grip.appointments%ROWTYPE;
  v_start timestamptz;
  v_end   timestamptz;
BEGIN
  SELECT * INTO v_appt FROM grip.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment not found'; END IF;
  IF v_appt.status NOT IN ('scheduled', 'confirmed', 'arrived') THEN
    RAISE EXCEPTION 'an appointment that is % cannot be changed', v_appt.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_minutes IS NULL OR p_minutes < 5 OR p_minutes > 1440 THEN
    RAISE EXCEPTION 'estimated time must be between 5 minutes and 24 hours'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_bay_id IS NOT NULL THEN
    PERFORM 1 FROM grip.bays WHERE id = p_bay_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'bay not found'; END IF;
  END IF;
  IF p_tech_id IS NOT NULL THEN
    PERFORM 1 FROM grip.employees WHERE id = p_tech_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'technician not found'; END IF;
  END IF;

  v_start := p_starts_local AT TIME ZONE v_tz;
  v_end   := v_start + p_minutes * interval '1 minute';
  PERFORM grip.assert_slot_free(p_bay_id, p_tech_id, v_start, v_end, p_id);

  UPDATE grip.appointments
  SET starts_at = v_start, estimated_minutes = p_minutes, bay_id = p_bay_id,
      assigned_tech_id = p_tech_id, concern = nullif(trim(p_concern), '')
  WHERE id = p_id;

  PERFORM grip.log_audit('appointment.updated', 'appointment', p_id,
    jsonb_build_object('from', v_appt.starts_at, 'to', v_start,
                       'bay_from', v_appt.bay_id, 'bay_to', p_bay_id,
                       'tech_from', v_appt.assigned_tech_id, 'tech_to', p_tech_id));
END;
$$;

-- scheduled/confirmed -> confirmed | arrived | cancelled | no_show
-- arrived             -> in_progress | cancelled
-- in_progress         -> completed
CREATE OR REPLACE FUNCTION grip.set_appointment_status(
  p_id uuid, p_to grip.appointment_status
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_appt grip.appointments%ROWTYPE;
  v_ok   boolean;
BEGIN
  SELECT * INTO v_appt FROM grip.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment not found'; END IF;

  v_ok := CASE v_appt.status
    WHEN 'scheduled'   THEN p_to IN ('confirmed', 'arrived', 'cancelled', 'no_show')
    WHEN 'confirmed'   THEN p_to IN ('arrived', 'cancelled', 'no_show')
    WHEN 'arrived'     THEN p_to IN ('in_progress', 'cancelled')
    WHEN 'in_progress' THEN p_to = 'completed'
    ELSE false
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'an appointment that is % cannot be marked %', v_appt.status, p_to
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.appointments SET status = p_to WHERE id = p_id;
  PERFORM grip.log_audit('appointment.' || p_to::text, 'appointment', p_id,
    jsonb_build_object('from', v_appt.status, 'to', p_to));
END;
$$;

-- ---------------------------------------------------------------------------
-- Appointment -> work order
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.convert_appointment_to_work_order(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_appt grip.appointments%ROWTYPE;
  v_wo   uuid;
BEGIN
  SELECT * INTO v_appt FROM grip.appointments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'appointment not found'; END IF;

  IF v_appt.status NOT IN ('scheduled', 'confirmed', 'arrived', 'in_progress') THEN
    RAISE EXCEPTION 'an appointment that is % cannot become a work order', v_appt.status
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM grip.work_orders WHERE appointment_id = p_id;
  IF FOUND THEN
    RAISE EXCEPTION 'this appointment already has a work order'
      USING ERRCODE = 'check_violation';
  END IF;

  v_wo := grip.create_work_order(v_appt.customer_id, v_appt.vehicle_id, v_appt.concern, NULL);
  UPDATE grip.work_orders SET appointment_id = p_id WHERE id = v_wo;

  -- The customer is here: a booked appointment becomes an arrival.
  IF v_appt.status IN ('scheduled', 'confirmed') THEN
    UPDATE grip.appointments SET status = 'arrived' WHERE id = p_id;
  END IF;

  PERFORM grip.log_audit('appointment.converted', 'appointment', p_id,
    jsonb_build_object('work_order', v_wo));
  RETURN v_wo;
END;
$$;

-- 0005's state machine, now keeping the linked appointment in step: starting a
-- job starts the appointment, completing it completes it.
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

  IF v_wo.appointment_id IS NOT NULL THEN
    IF p_to = 'in_progress' THEN
      UPDATE grip.appointments SET status = 'in_progress'
      WHERE id = v_wo.appointment_id AND status IN ('scheduled', 'confirmed', 'arrived');
    ELSIF p_to = 'completed' THEN
      UPDATE grip.appointments SET status = 'completed'
      WHERE id = v_wo.appointment_id AND status IN ('scheduled', 'confirmed', 'arrived', 'in_progress');
    END IF;
  END IF;

  PERFORM grip.log_audit('work_order.' || p_to::text, 'work_order', p_work_order_id,
    jsonb_build_object('from', v_wo.status, 'to', p_to));
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
