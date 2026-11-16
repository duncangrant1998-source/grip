-- Time-off requests.
--
-- A member of staff asks for days off, addressed to their administrator or to
-- whoever they pick. The person it is addressed to — or any shop administrator —
-- approves or declines it, with an optional reply. The request, the answer and
-- who gave it all stay on record.
--
-- Two requests for overlapping days are refused outright (they would only
-- contradict each other), but a declined or withdrawn one frees the days up.

CREATE TYPE grip.time_off_status AS ENUM ('pending', 'approved', 'declined', 'cancelled');

CREATE TABLE grip.time_off_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES grip.employees(id) ON DELETE CASCADE,
  -- Whose inbox it lands in. Not a foreign-key cascade: if that person leaves, the
  -- request must still exist for an administrator to answer.
  recipient_user_id uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  note            text,
  status          grip.time_off_status NOT NULL DEFAULT 'pending',
  decided_by      uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date),
  CHECK (to_date - from_date <= 90)
);

CREATE INDEX time_off_employee_idx  ON grip.time_off_requests (tenant_id, employee_id, from_date);
CREATE INDEX time_off_recipient_idx ON grip.time_off_requests (recipient_user_id) WHERE status = 'pending';

ALTER TABLE grip.time_off_requests
  ADD CONSTRAINT time_off_no_overlap EXCLUDE USING gist (
    employee_id WITH =,
    daterange(from_date, to_date, '[]') WITH &&
  ) WHERE (status IN ('pending', 'approved'));

ALTER TABLE grip.time_off_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY time_off_requests_tenant_isolation ON grip.time_off_requests
  FOR ALL TO grip_app
  USING (grip.tenant_visible(tenant_id))
  WITH CHECK (grip.tenant_visible(tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON grip.time_off_requests TO grip_app;

-- ---------------------------------------------------------------------------
-- Asking
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION grip.request_time_off(
  p_from      date,
  p_to        date,
  p_note      text,
  p_recipient uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tenant    uuid := grip.current_tenant_id();
  v_user      uuid := grip.current_user_id();
  v_emp       uuid := grip.my_employee_id();
  v_recipient uuid := p_recipient;
  v_today     date := (now() AT TIME ZONE grip.shop_timezone())::date;
  v_id        uuid;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'your login is not linked to a staff record — ask an administrator'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'the last day cannot be before the first' USING ERRCODE = 'check_violation';
  END IF;
  IF p_to - p_from > 90 THEN
    RAISE EXCEPTION 'a request can cover at most 90 days' USING ERRCODE = 'check_violation';
  END IF;
  IF p_to < v_today THEN
    RAISE EXCEPTION 'those days have already passed' USING ERRCODE = 'check_violation';
  END IF;

  IF v_recipient IS NULL THEN
    -- No one chosen: the shop's administrators. Pick the longest-serving one.
    SELECT id INTO v_recipient FROM grip.users
    WHERE role = 'shop_admin' AND is_active AND id <> v_user
    ORDER BY created_at LIMIT 1;
    IF v_recipient IS NULL THEN
      RAISE EXCEPTION 'there is no one to send this to — choose who should receive it'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF v_recipient = v_user THEN
      RAISE EXCEPTION 'send the request to someone else' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM grip.users WHERE id = v_recipient AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'that person was not found' USING ERRCODE = 'P0001'; END IF;
  END IF;

  INSERT INTO grip.time_off_requests
    (tenant_id, employee_id, recipient_user_id, from_date, to_date, note)
  VALUES (v_tenant, v_emp, v_recipient, p_from, p_to, nullif(trim(coalesce(p_note, '')), ''))
  RETURNING id INTO v_id;

  PERFORM grip.log_audit('time_off.requested', 'time_off', v_id,
    jsonb_build_object('from', p_from, 'to', p_to, 'to_user', v_recipient));
  RETURN v_id;
END;
$$;

-- Withdrawn by the person who asked, while it is still waiting.
CREATE OR REPLACE FUNCTION grip.cancel_time_off(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_req grip.time_off_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM grip.time_off_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;
  IF v_req.employee_id IS DISTINCT FROM grip.my_employee_id() THEN
    RAISE EXCEPTION 'you can only withdraw your own requests' USING ERRCODE = 'check_violation';
  END IF;
  IF v_req.status NOT IN ('pending') THEN
    RAISE EXCEPTION 'a request that is % cannot be withdrawn', v_req.status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.time_off_requests SET status = 'cancelled' WHERE id = p_id;
  PERFORM grip.log_audit('time_off.cancelled', 'time_off', p_id, NULL);
END;
$$;

-- ---------------------------------------------------------------------------
-- Answering
-- ---------------------------------------------------------------------------

-- Whoever it was addressed to, or any shop administrator, can answer it.
CREATE OR REPLACE FUNCTION grip.decide_time_off(p_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_user uuid := grip.current_user_id();
  v_role grip.user_role;
  v_req  grip.time_off_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM grip.time_off_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found'; END IF;

  SELECT role INTO v_role FROM grip.users WHERE id = v_user;
  IF v_req.recipient_user_id IS DISTINCT FROM v_user AND v_role <> 'shop_admin' THEN
    RAISE EXCEPTION 'this request was not sent to you' USING ERRCODE = 'check_violation';
  END IF;
  -- Nobody approves their own time off.
  IF v_req.employee_id IS NOT DISTINCT FROM grip.my_employee_id() THEN
    RAISE EXCEPTION 'you cannot answer your own request' USING ERRCODE = 'check_violation';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'that request has already been %', v_req.status USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.time_off_requests
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END::grip.time_off_status,
      decided_by = v_user, decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), '')
  WHERE id = p_id;

  PERFORM grip.log_audit(CASE WHEN p_approve THEN 'time_off.approved' ELSE 'time_off.declined' END,
    'time_off', p_id, jsonb_build_object('from', v_req.from_date, 'to', v_req.to_date));
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
