-- Removing a bay.
--
-- Bays could be added and retired but never deleted, so a shop that mistyped a
-- name, or set up more bays than it has, was stuck with the extras cluttering
-- the schedule forever.
--
-- Deleting is only safe when nothing points at the bay. `appointments.bay_id`
-- is ON DELETE SET NULL, so a plain DELETE would quietly strip the bay off
-- historic work and lose where the job was done. So: delete a bay that has no
-- history, and tell the shop to retire one that has.

CREATE OR REPLACE FUNCTION grip.delete_bay(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_bay      grip.bays%ROWTYPE;
  v_upcoming bigint;
  v_total    bigint;
BEGIN
  SELECT * INTO v_bay FROM grip.bays WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bay not found';
  END IF;

  SELECT count(*) INTO v_total FROM grip.appointments WHERE bay_id = p_id;

  SELECT count(*) INTO v_upcoming
  FROM grip.appointments
  WHERE bay_id = p_id
    AND starts_at >= now()
    AND status IN ('scheduled', 'confirmed', 'arrived', 'in_progress');

  IF v_upcoming > 0 THEN
    RAISE EXCEPTION
      'Move or cancel the % upcoming appointment% in this bay first.',
      v_upcoming, CASE WHEN v_upcoming = 1 THEN '' ELSE 's' END
      USING ERRCODE = 'P0001';
  END IF;

  IF v_total > 0 THEN
    RAISE EXCEPTION
      'This bay has % appointment% on record. Retire it instead, so that work keeps its bay.',
      v_total, CASE WHEN v_total = 1 THEN '' ELSE 's' END
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM grip.bays WHERE id = p_id;

  PERFORM grip.log_audit('bay.deleted', 'bay', p_id,
    jsonb_build_object('name', v_bay.name));
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
