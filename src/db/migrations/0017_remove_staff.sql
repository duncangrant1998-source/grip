-- Removing a member of staff.
--
-- Deactivating someone leaves their account sitting there, able to be switched
-- back on and still occupying an email address. Removing them is final for the
-- account and kinder to the records: the LOGIN is closed for good and its email
-- freed, while the PERSON stays on file — name, title, pay, the hours they
-- worked, who they were on every work order, line and invoice — so that
-- history keeps meaning what it meant.
--
-- Nothing is deleted. A user row that disappeared would turn every "added by
-- Sam Reyes" in the shop's history into a blank.

ALTER TABLE grip.employees
  ADD COLUMN IF NOT EXISTS removed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by   uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS removal_note text;

CREATE INDEX IF NOT EXISTS employees_removed_idx ON grip.employees (tenant_id) WHERE removed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION grip.remove_employee(p_employee_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_me         uuid := grip.current_user_id();
  v_emp        grip.employees%ROWTYPE;
  v_user       grip.users%ROWTYPE;
  v_clocked    integer := 0;
  v_shifts     integer := 0;
  v_unassigned integer := 0;
  v_requests   integer := 0;
BEGIN
  -- Same lock order as update_user_access, so two administrators removing each
  -- other cannot both succeed and leave the shop with none.
  PERFORM 1 FROM grip.users
  WHERE tenant_id = grip.current_tenant_id() AND role = 'shop_admin' AND is_active
  ORDER BY id FOR UPDATE;

  SELECT * INTO v_emp FROM grip.employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff member not found'; END IF;
  IF v_emp.removed_at IS NOT NULL THEN
    RAISE EXCEPTION '% has already been removed', v_emp.full_name USING ERRCODE = 'check_violation';
  END IF;

  IF v_emp.user_id IS NOT NULL THEN
    SELECT * INTO v_user FROM grip.users WHERE id = v_emp.user_id FOR UPDATE;

    IF v_emp.user_id = v_me THEN
      RAISE EXCEPTION 'you cannot remove yourself' USING ERRCODE = 'check_violation';
    END IF;

    IF v_user.role = 'shop_admin' AND v_user.is_active THEN
      PERFORM 1 FROM grip.users
      WHERE tenant_id = v_user.tenant_id AND role = 'shop_admin' AND is_active AND id <> v_user.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'a shop must keep at least one active administrator'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- If they are on the clock, close it now: otherwise it would run for ever.
  UPDATE grip.time_entries
  SET clock_out = now(), note = trim(concat_ws(' · ', note, 'closed when removed from staff'))
  WHERE employee_id = p_employee_id AND clock_out IS NULL;
  GET DIAGNOSTICS v_clocked = ROW_COUNT;

  -- Shifts that have not started are no longer anyone's; the ones already worked stay.
  DELETE FROM grip.shifts WHERE employee_id = p_employee_id AND starts_at > now();
  GET DIAGNOSTICS v_shifts = ROW_COUNT;

  -- A booking should not keep a technician who has gone. It is left unassigned,
  -- for the service desk to give to someone else.
  UPDATE grip.appointments
  SET assigned_tech_id = NULL
  WHERE assigned_tech_id = p_employee_id
    AND status IN ('scheduled', 'confirmed', 'arrived') AND starts_at > now();
  GET DIAGNOSTICS v_unassigned = ROW_COUNT;

  -- Their own pending requests are withdrawn; ones addressed to them go to the administrators.
  UPDATE grip.time_off_requests SET status = 'cancelled'
  WHERE employee_id = p_employee_id AND status = 'pending';
  GET DIAGNOSTICS v_requests = ROW_COUNT;
  IF v_emp.user_id IS NOT NULL THEN
    UPDATE grip.time_off_requests SET recipient_user_id = NULL
    WHERE recipient_user_id = v_emp.user_id AND status = 'pending';
  END IF;

  -- Close the login: no way back in, sessions ended, the email free to be used again.
  IF v_emp.user_id IS NOT NULL THEN
    UPDATE grip.sessions SET revoked_at = now() WHERE user_id = v_emp.user_id AND revoked_at IS NULL;
    UPDATE grip.users
    SET is_active = false,
        password_hash = '!removed',
        email = 'removed+' || id::text || '@removed.invalid',
        updated_at = now()
    WHERE id = v_emp.user_id;
  END IF;

  UPDATE grip.employees
  SET is_active = false, removed_at = now(), removed_by = v_me,
      removal_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  WHERE id = p_employee_id;

  PERFORM grip.log_audit('staff.removed', 'employee', p_employee_id,
    jsonb_build_object('name', v_emp.full_name, 'email', v_user.email, 'role', v_user.role,
                       'clocked_out', v_clocked, 'shifts_removed', v_shifts,
                       'appointments_unassigned', v_unassigned));

  RETURN jsonb_build_object('shifts_removed', v_shifts, 'appointments_unassigned', v_unassigned,
                            'clocked_out', v_clocked, 'requests_withdrawn', v_requests);
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
