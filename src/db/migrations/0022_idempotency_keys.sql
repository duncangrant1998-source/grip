-- ---------------------------------------------------------------------------
-- Idempotency keys: safe retries for actions that create a new record.
--
-- A flaky connection can make the browser resend a form after the first
-- submission already reached the server and succeeded (the request landed,
-- but the response never made it back). Without this, that resend creates a
-- second work order, a second purchase order, and so on.
--
-- Each ActionForm submission carries a client-generated key. The first time a
-- key is seen for a given scope, the action runs normally and its outcome is
-- recorded here. A repeat of the same key within the same scope is not
-- re-run — the recorded outcome is replayed instead, so retrying is always
-- safe. Rows are cheap and short-lived; `created_at` lets old ones be pruned.
-- ---------------------------------------------------------------------------

CREATE TABLE grip.idempotency_keys (
  key        uuid NOT NULL,
  tenant_id  uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  scope      text NOT NULL,
  result     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
CREATE INDEX idempotency_keys_created_at_idx ON grip.idempotency_keys (created_at);

ALTER TABLE grip.idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_keys_tenant_isolation ON grip.idempotency_keys
  USING (grip.tenant_visible(tenant_id))
  WITH CHECK (grip.tenant_visible(tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON grip.idempotency_keys TO grip_app;
