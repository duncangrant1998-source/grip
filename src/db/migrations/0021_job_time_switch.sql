-- Switching or restarting jobs inside a second: an entry that is closed is given at
-- least one second, so the next one must not start before that ends.
CREATE OR REPLACE FUNCTION grip.start_job_time(p_work_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := grip.current_tenant_id();
  v_emp    uuid := grip.my_employee_id();
  v_status grip.work_order_status;
  v_last   timestamptz;
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

  -- Never start before the last entry ended (stopping and starting within a second).
  SELECT max(clock_out) INTO v_last FROM grip.job_time_entries WHERE employee_id = v_emp;

  INSERT INTO grip.job_time_entries (tenant_id, employee_id, work_order_id, clock_in)
  VALUES (v_tenant, v_emp, p_work_order_id, greatest(now(), coalesce(v_last, now())))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
