-- Grip — 0026 — intershop messaging.
--
-- Direct messages between two coworkers at the same shop. One thread per
-- unordered pair of users per tenant — `user_a_id`/`user_b_id` are always
-- stored least-to-greatest so the same two people can never end up with two
-- threads. Read state is tracked per side directly on the thread row rather
-- than a separate participants table, since a thread only ever has two sides.
--
-- Delivery is polling (LiveRefresh on the inbox and thread pages), not a
-- push subscription — plenty for coworkers on the same shop floor, and it can
-- become a push subscription later without touching this schema.
--
-- Scoping is tighter than the usual tenant_visible() policy: the normal
-- tenant-isolation loop in 0003 only keeps shop A out of shop B's rows. A
-- message additionally has to stay between the two people on the thread —
-- nobody else *at the same shop* should be able to read someone else's DMs by
-- guessing an id. That extra half of the check is enforced here, in RLS, not
-- left to the query layer, because unlike the role-based narrowing elsewhere
-- (e.g. a technician's own-job view in queries.ts) this is a hard privacy
-- boundary, not a convenience filter.

CREATE TABLE grip.message_threads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  user_a_id            uuid NOT NULL REFERENCES grip.users(id) ON DELETE CASCADE,
  user_b_id            uuid NOT NULL REFERENCES grip.users(id) ON DELETE CASCADE,
  user_a_last_read_at  timestamptz,
  user_b_last_read_at  timestamptz,
  last_message_at      timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a_id < user_b_id)
);
CREATE UNIQUE INDEX message_threads_pair_key ON grip.message_threads (tenant_id, user_a_id, user_b_id);
CREATE INDEX message_threads_a_idx ON grip.message_threads (user_a_id, last_message_at DESC);
CREATE INDEX message_threads_b_idx ON grip.message_threads (user_b_id, last_message_at DESC);

CREATE TABLE grip.messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  thread_id  uuid NOT NULL REFERENCES grip.message_threads(id) ON DELETE CASCADE,
  sender_id  uuid NOT NULL REFERENCES grip.users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (length(trim(body)) > 0 AND length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_idx ON grip.messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE grip.message_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY message_threads_participants_only ON grip.message_threads
  FOR ALL TO grip_app
  USING (
    grip.tenant_visible(tenant_id)
    AND (grip.current_is_platform_admin() OR grip.current_user_id() IN (user_a_id, user_b_id))
  )
  WITH CHECK (
    grip.tenant_visible(tenant_id)
    AND (grip.current_is_platform_admin() OR grip.current_user_id() IN (user_a_id, user_b_id))
  );

ALTER TABLE grip.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_participants_only ON grip.messages
  FOR ALL TO grip_app
  USING (
    grip.tenant_visible(tenant_id)
    AND EXISTS (
      SELECT 1 FROM grip.message_threads t
      WHERE t.id = thread_id
        AND (grip.current_is_platform_admin() OR grip.current_user_id() IN (t.user_a_id, t.user_b_id))
    )
  )
  WITH CHECK (
    grip.tenant_visible(tenant_id)
    AND EXISTS (
      SELECT 1 FROM grip.message_threads t
      WHERE t.id = thread_id
        AND (grip.current_is_platform_admin() OR grip.current_user_id() IN (t.user_a_id, t.user_b_id))
    )
  );

GRANT SELECT, INSERT, UPDATE ON grip.message_threads TO grip_app;
GRANT SELECT, INSERT ON grip.messages TO grip_app;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Not SECURITY DEFINER: it runs as grip_app like the rest of the application,
-- so the RLS policies above apply to every statement inside it exactly as
-- they would to a hand-written query. A recipient outside the caller's own
-- tenant is simply invisible to the `grip.users` lookup below (RLS on users
-- again), so it fails as "not available to message" rather than leaking
-- whether that id exists at all.
CREATE OR REPLACE FUNCTION grip.send_message(p_recipient_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sender    uuid := grip.current_user_id();
  v_tenant    uuid := grip.current_tenant_id();
  v_a         uuid;
  v_b         uuid;
  v_thread_id uuid;
  v_body      text := trim(coalesce(p_body, ''));
  v_message_id uuid;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'no signed-in user' USING ERRCODE = 'P0001';
  END IF;
  IF p_recipient_id = v_sender THEN
    RAISE EXCEPTION 'You can''t message yourself.' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_body) = 0 THEN
    RAISE EXCEPTION 'Write something before sending.' USING ERRCODE = 'P0001';
  END IF;
  IF length(v_body) > 4000 THEN
    RAISE EXCEPTION 'That message is too long (4000 characters max).' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM grip.users WHERE id = p_recipient_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That coworker is not available to message.' USING ERRCODE = 'P0001';
  END IF;

  IF v_sender < p_recipient_id THEN
    v_a := v_sender; v_b := p_recipient_id;
  ELSE
    v_a := p_recipient_id; v_b := v_sender;
  END IF;

  INSERT INTO grip.message_threads (tenant_id, user_a_id, user_b_id, last_message_at)
  VALUES (v_tenant, v_a, v_b, now())
  ON CONFLICT (tenant_id, user_a_id, user_b_id)
  DO UPDATE SET last_message_at = now()
  RETURNING id INTO v_thread_id;

  INSERT INTO grip.messages (tenant_id, thread_id, sender_id, body)
  VALUES (v_tenant, v_thread_id, v_sender, v_body)
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

-- A no-op if the caller isn't on the thread (RLS confines the UPDATE to rows
-- already visible to them) or if the thread doesn't exist — neither is worth
-- raising over, since this is called opportunistically whenever a thread is
-- opened.
CREATE OR REPLACE FUNCTION grip.mark_thread_read(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := grip.current_user_id();
BEGIN
  UPDATE grip.message_threads
  SET user_a_last_read_at = CASE WHEN user_a_id = v_uid THEN now() ELSE user_a_last_read_at END,
      user_b_last_read_at = CASE WHEN user_b_id = v_uid THEN now() ELSE user_b_last_read_at END
  WHERE id = p_thread_id
    AND v_uid IN (user_a_id, user_b_id);
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA grip TO grip_app;
