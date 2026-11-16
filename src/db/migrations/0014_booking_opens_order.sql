-- Booking an appointment starts the work order.
--
-- Booking used to be a form that made a calendar entry and nothing else; the
-- work order only appeared later, when someone pressed "convert". But the work
-- starts at booking: the advisor is already taking the concern, quoting the
-- job, and the parts desk wants to see what is coming so it can get the parts
-- in. So the booking now creates the appointment AND its quote together, linked,
-- and the person lands on the work order.
--
-- It deliberately does not use convert_appointment_to_work_order, which marks
-- the appointment "arrived". Someone booking for next Thursday has not arrived.

CREATE OR REPLACE FUNCTION grip.create_appointment_with_order(
  p_customer_id  uuid,
  p_vehicle_id   uuid,
  p_starts_local timestamp,
  p_minutes      integer,
  p_bay_id       uuid DEFAULT NULL,
  p_tech_id      uuid DEFAULT NULL,
  p_concern      text DEFAULT NULL
)
RETURNS uuid                      -- the work order
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_appt uuid;
  v_wo   uuid;
BEGIN
  -- Booking checks the slot, the bay and the technician, and raises if any clash.
  v_appt := grip.create_appointment(p_customer_id, p_vehicle_id, p_starts_local,
                                    p_minutes, p_bay_id, p_tech_id, p_concern);

  v_wo := grip.create_work_order(p_customer_id, p_vehicle_id, p_concern, NULL);
  UPDATE grip.work_orders SET appointment_id = v_appt WHERE id = v_wo;

  PERFORM grip.log_audit('appointment.order_created', 'appointment', v_appt,
    jsonb_build_object('work_order', v_wo));
  RETURN v_wo;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cancelling a booking should not leave an empty quote behind
-- ---------------------------------------------------------------------------

-- Every booking now has a quote, so a cancelled one would leave a stray quote in
-- the Quotes list forever. If the quote is still untouched — a quote, with no
-- labour and no parts on it — it is cancelled with the booking. Anything with
-- work on it is left alone: someone has put effort in and can decide.
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
  v_wo   grip.work_orders%ROWTYPE;
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

  IF p_to IN ('cancelled', 'no_show') THEN
    SELECT * INTO v_wo FROM grip.work_orders
    WHERE appointment_id = p_id AND status = 'quote' FOR UPDATE;
    IF FOUND
       AND NOT EXISTS (SELECT 1 FROM grip.work_order_labour_lines WHERE work_order_id = v_wo.id)
       AND NOT EXISTS (SELECT 1 FROM grip.work_order_part_lines   WHERE work_order_id = v_wo.id)
    THEN
      PERFORM grip.transition_work_order(v_wo.id, 'cancelled');
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
