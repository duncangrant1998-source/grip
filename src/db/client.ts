import postgres from "postgres";

/**
 * Two connections, two different Postgres roles.
 *
 *  - `appSql`   connects as `grip_app`: NOBYPASSRLS, owns no tables. Every
 *               request path uses this. If a policy would hide a row, it is
 *               hidden — there is no query that gets around it.
 *  - `ownerSql` connects as the owning role, which DOES bypass RLS. Migrations,
 *               seeds and test fixtures only. Never reachable from a request.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/**
 * The pools live on globalThis, not in module scope.
 *
 * In development Next re-evaluates this module on every hot reload. A pool
 * held in a module variable is then orphaned, still open and never closed, and
 * a few dozen edits later Postgres has run out of connection slots (it did:
 * 87 idle connections from one dev session, enough to make the test suite fail
 * with "remaining connection slots are reserved"). Keeping the pool on the
 * global means every reload finds and reuses the one that already exists. In
 * production the module is loaded once, so this changes nothing there.
 */
const g = globalThis as unknown as {
  __gripAppSql?: postgres.Sql;
  __gripOwnerSql?: postgres.Sql;
};

export function appSql(): postgres.Sql {
  // prepare: false — DATABASE_URL in production runs through Neon's pooled
  // (pgbouncer, transaction-mode) endpoint, which cannot hold prepared
  // statements across pooled connections.
  g.__gripAppSql ??= postgres(required("DATABASE_URL"), { max: 10, prepare: false });
  return g.__gripAppSql;
}

export function ownerSql(): postgres.Sql {
  g.__gripOwnerSql ??= postgres(required("DATABASE_URL_OWNER"), { max: 4, prepare: false });
  return g.__gripOwnerSql;
}

export type TenantContext = {
  tenantId: string;
  userId: string;
  isPlatformAdmin: boolean;
};

/**
 * Run `fn` inside a transaction scoped to one tenant and one user.
 *
 * The three settings are set LOCAL, so they live and die with the transaction
 * and cannot leak to the next borrower of a pooled connection. Row-level
 * security policies read them through `current_tenant_id()` /
 * `current_user_id()` / `current_is_platform_admin()`.
 *
 * This is the ONLY sanctioned way to read or write tenant data. A query issued
 * outside it has no `app.tenant_id` set, and `current_tenant_id()` raises
 * rather than quietly returning nothing.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return appSql().begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
    await tx`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
    await tx`SELECT set_config('app.is_platform_admin', ${String(ctx.isPlatformAdmin)}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * For the handful of pre-authentication queries (looking up a user by email at
 * login, validating a session cookie). These touch tables whose policies do not
 * depend on a tenant being chosen yet.
 */
export async function withoutTenant<T>(
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return appSql().begin(async (tx) => fn(tx)) as Promise<T>;
}
