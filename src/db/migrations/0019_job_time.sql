-- ---------------------------------------------------------------------------
-- Job time: two clocks that run side by side.
--
--   time_entries      the shift. Clock in when the day starts, out when it ends,
--                     whoever you are. This is what hourly pay is worked out from.
--   job_time_entries  time on a particular work order, one job at a time, started
--                     and stopped from inside the shift. For a flat-rate tech it
--                     records how long they were on site; for an hourly tech it
--                     shows how many of their paid hours went into billable work.
--
-- Rows already in time_entries that carry a work order are history from before
-- the split and still count as shift time.
-- ---------------------------------------------------------------------------

CREATE TABLE grip.job_time_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES grip.employees(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES grip.work_orders(id) ON DELETE CASCADE,
  clock_in      timestamptz NOT NULL,
  clock_out     timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (clock_out IS NULL OR clock_out > clock_in),
  -- One job at a time: an open entry is an unbounded range.
  CONSTRAINT job_time_no_overlap
    EXCLUDE USING gist (employee_id WITH =, tstzrange(clock_in, clock_out) WITH &&)
);
CREATE INDEX job_time_tenant_wo_idx ON grip.job_time_entries (tenant_id, work_order_id);
CREATE INDEX job_time_tenant_emp_idx ON grip.job_time_entries (tenant_id, employee_id, clock_in);

ALTER TABLE grip.job_time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_time_entries_tenant_isolation ON grip.job_time_entries
  USING (grip.tenant_visible(tenant_id))
  WITH CHECK (grip.tenant_visible(tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON grip.job_time_entries TO grip_app;

-- The shift clock no longer carries a job.
CREATE OR REPLACE FUNCTION grip.clock_in(p_work_order_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_emp    uuid := grip.my_employee_id();
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

  INSERT INTO grip.time_entries (tenant_id, employee_id, clock_in)
  VALUES (v_tenant, v_emp, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Ending the shift, by anyone and any route (clocking out, an administrator's
-- correction, removing the person), ends the job they were on.
CREATE OR REPLACE FUNCTION grip.close_job_time_with_shift()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.clock_out IS NOT NULL AND OLD.clock_out IS NULL THEN
    UPDATE grip.job_time_entries
    SET clock_out = greatest(NEW.clock_out, clock_in + interval '1 second')
    WHERE employee_id = NEW.employee_id AND clock_out IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER time_entries_close_job_time
  AFTER UPDATE OF clock_out ON grip.time_entries
  FOR EACH ROW EXECUTE FUNCTION grip.close_job_time_with_shift();

-- Starting a job moves off the previous one: there is only ever one open.
CREATE OR REPLACE FUNCTION grip.start_job_time(p_work_order_id uuid)
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'clock in to your shift first, then start the job'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO v_status FROM grip.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'work order not found'; END IF;
  IF v_status NOT IN ('quote', 'approved', 'in_progress') THEN
    RAISE EXCEPTION 'you can only log time on an open work order'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.job_time_entries
  SET clock_out = greatest(now(), clock_in + interval '1 second')
  WHERE employee_id = v_emp AND clock_out IS NULL;

  INSERT INTO grip.job_time_entries (tenant_id, employee_id, work_order_id, clock_in)
  VALUES (v_tenant, v_emp, p_work_order_id, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Returns the minutes just logged.
CREATE OR REPLACE FUNCTION grip.stop_job_time()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_emp   uuid := grip.my_employee_id();
  v_entry grip.job_time_entries%ROWTYPE;
BEGIN
  UPDATE grip.job_time_entries
  SET clock_out = greatest(now(), clock_in + interval '1 second')
  WHERE employee_id = v_emp AND clock_out IS NULL
  RETURNING * INTO v_entry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'you are not on a job' USING ERRCODE = 'check_violation';
  END IF;
  RETURN (extract(epoch FROM v_entry.clock_out - v_entry.clock_in) / 60)::int;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
