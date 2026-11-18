-- Grip — 0024 — self-service password reset.
--
-- Before this, a forgotten password could only be fixed by a shop admin
-- resetting it from the Staff tab (grip.set_user_password, 0008). This adds
-- the "Forgot password?" path on the login page itself: request a link,
-- click it, choose a new password — no admin involved.
--
-- The raw token is never stored. The application generates it, hashes it
-- (a fast hash is fine here — it's 256 bits of randomness, not a
-- low-entropy human password that needs argon2's slowness), and only the
-- hash lands in this table, the same split already used for user passwords
-- (argon2 happens in the app layer; grip.set_user_password only ever sees a
-- hash). Email delivery, like the rest of outbound mail, happens in the
-- application layer (Postgres cannot make HTTP calls).
--
-- Pre-authentication, exactly like find_users_for_login / create_session in
-- 0003, so the two functions that touch it run SECURITY DEFINER and are
-- locked to grip_app only.

CREATE TABLE grip.password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES grip.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON grip.password_resets (user_id);
-- Collisions would mean two different users' links resolve to the same row;
-- at 256 bits of randomness this is a belt-and-suspenders constraint, not a
-- real-world concern.
CREATE UNIQUE INDEX password_resets_token_hash_key ON grip.password_resets (token_hash);

-- Not tenant-owned the usual way (nobody has a tenant chosen yet when this is
-- written or read), so it rides the same "platform admin only, written via a
-- SECURITY DEFINER function that bypasses RLS" shape as login_attempts (0022).
ALTER TABLE grip.password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY password_resets_platform_only ON grip.password_resets
  FOR ALL TO grip_app
  USING (grip.current_is_platform_admin())
  WITH CHECK (grip.current_is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON grip.password_resets TO grip_app;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Issues one token for one already-identified user (the caller looked them up
-- via grip.find_users_for_login, so this never has to touch users itself).
-- Any link already out for this user stops working the moment a new one is
-- requested, and a flood of requests for the same account is capped rather
-- than used to mail-bomb someone.
CREATE OR REPLACE FUNCTION grip.create_password_reset(
  p_user_id     uuid,
  p_token_hash  text,
  p_ttl_minutes integer DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_recent integer;
BEGIN
  SELECT count(*) INTO v_recent
  FROM grip.password_resets
  WHERE user_id = p_user_id AND created_at > now() - interval '1 hour';
  IF v_recent >= 5 THEN
    RETURN false;
  END IF;

  UPDATE grip.password_resets SET used_at = now()
  WHERE user_id = p_user_id AND used_at IS NULL;

  INSERT INTO grip.password_resets (user_id, token_hash, expires_at)
  VALUES (p_user_id, p_token_hash, now() + make_interval(mins => p_ttl_minutes));
  RETURN true;
END;
$$;

-- Validates a token, sets the new password, and consumes the token, all in
-- one step — the window between "token checked out" and "password changed"
-- where a link could be reused does not exist. Revokes every live session for
-- the account, same as an admin-initiated reset (grip.set_user_password), and
-- leaves an audit_log entry even though it runs before any tenant is chosen,
-- by taking the tenant from the token's own user rather than
-- current_tenant_id().
CREATE OR REPLACE FUNCTION grip.complete_password_reset(
  p_token_hash    text,
  p_password_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reset grip.password_resets%ROWTYPE;
BEGIN
  IF coalesce(p_password_hash, '') = '' THEN
    RAISE EXCEPTION 'a password is required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_reset FROM grip.password_resets WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_reset.used_at IS NOT NULL OR v_reset.expires_at < now() THEN
    RAISE EXCEPTION 'that reset link is invalid or has expired' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE grip.password_resets SET used_at = now() WHERE id = v_reset.id;
  UPDATE grip.users SET password_hash = p_password_hash, updated_at = now()
  WHERE id = v_reset.user_id;
  UPDATE grip.sessions SET revoked_at = now()
  WHERE user_id = v_reset.user_id AND revoked_at IS NULL;

  INSERT INTO grip.audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff)
  SELECT u.tenant_id, u.id, 'user.password_reset', 'user', u.id,
         jsonb_build_object('via', 'self_service')
  FROM grip.users u WHERE u.id = v_reset.user_id;

  RETURN v_reset.user_id;
END;
$$;

REVOKE ALL ON FUNCTION grip.create_password_reset(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION grip.complete_password_reset(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grip.create_password_reset(uuid, text, integer) TO grip_app;
GRANT EXECUTE ON FUNCTION grip.complete_password_reset(text, text) TO grip_app;
