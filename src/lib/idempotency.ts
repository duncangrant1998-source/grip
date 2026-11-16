import "server-only";
import type postgres from "postgres";

/**
 * Runs `fn` at most once per (scope, key).
 *
 * ActionForm attaches a fresh random key to every form submission. A normal
 * submission is the first time its key is seen under that scope, so `fn` runs
 * and its result is recorded. If the connection drops after the server
 * finishes but before the response reaches the browser, the browser (or the
 * person, unsure whether it went through) may resend the exact same
 * submission — same key. That replay is recognised here and the recorded
 * result is returned as-is, without running `fn` again, so a retried
 * "create a work order" / "create a purchase order" can never produce two.
 *
 * Must be called with the SAME transaction that `fn` writes through (the one
 * `inShop`/`withTenant` already opened), so if `fn` throws, the attempted
 * record of success rolls back with everything else — a failed attempt is
 * never remembered as having happened, and a genuinely failed submission can
 * still be retried as a first attempt.
 *
 * `key` is optional only so a caller that has none (an older cached client
 * bundle, say) degrades to "always run `fn`" rather than breaking outright.
 */
export async function withIdempotency<T extends object>(
  tx: postgres.TransactionSql,
  tenantId: string,
  scope: string,
  key: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!key) return fn();

  const [existing] = await tx<{ result: T }[]>`
    SELECT result FROM grip.idempotency_keys WHERE scope = ${scope} AND key = ${key}`;
  if (existing) return existing.result;

  const result = await fn();
  await tx`
    INSERT INTO grip.idempotency_keys (key, tenant_id, scope, result)
    VALUES (${key}, ${tenantId}, ${scope}, ${JSON.stringify(result)}::jsonb)
    ON CONFLICT (scope, key) DO NOTHING`;
  return result;
}

/** Pulls the key ActionForm attaches to every submission out of the FormData, if present. */
export function idemKeyFrom(form: FormData): string | null {
  const v = form.get("_idemKey");
  return typeof v === "string" && v.length > 0 ? v : null;
}
