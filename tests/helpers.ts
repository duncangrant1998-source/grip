/**
 * Test fixtures.
 *
 * Two connections, matching production:
 *   owner() — bypasses RLS, used only to build and tear down fixtures
 *   app()   — the restricted grip_app role, used for everything under test
 *
 * If these tests ever pass while pointed at the owner connection they prove
 * nothing, so `assertAppRoleIsRestricted` checks that up front.
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

let _owner: postgres.Sql | undefined;
let _app: postgres.Sql | undefined;

export function owner(): postgres.Sql {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");
  _owner ??= postgres(url, { max: 4, onnotice: () => {} });
  return _owner;
}

export function app(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _app ??= postgres(url, { max: 8, onnotice: () => {} });
  return _app;
}

/** A second, independent app connection — for the concurrency tests. */
export function appAlt(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, { max: 2, onnotice: () => {} });
}

export async function closeAll() {
  await Promise.all([_owner?.end(), _app?.end()]);
  _owner = undefined;
  _app = undefined;
}

export type Ctx = {
  tenantId: string;
  userId: string;
  isPlatformAdmin?: boolean;
};

/** Mirrors withTenant() in src/db/client.ts. */
export async function asTenant<T>(
  sql: postgres.Sql,
  ctx: Ctx,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true)`;
    await tx`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
    await tx`SELECT set_config('app.is_platform_admin', ${String(ctx.isPlatformAdmin ?? false)}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * The test suite is worthless if the connection under test can bypass RLS.
 * Check, rather than assume the .env is wired correctly.
 */
export async function assertAppRoleIsRestricted() {
  const [row] = await app()<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }[]>`
    SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;

  if (row.rolbypassrls || row.rolsuper) {
    throw new Error(
      `DATABASE_URL connects as "${row.rolname}", which bypasses row-level security ` +
        `(bypassrls=${row.rolbypassrls}, superuser=${row.rolsuper}). ` +
        `The isolation tests would pass vacuously. Point DATABASE_URL at grip_app.`,
    );
  }
}

export type Shop = {
  tenantId: string;
  users: Record<string, string>;
  parts: Record<string, string>;
  customerId: string;
  vehicleId: string;
  taxRateId: string;
};

/**
 * Builds one self-contained shop. Both shops the tests create use the same
 * SKUs and customer names on purpose, so a leak shows up as wrong data rather
 * than as an empty result.
 */
export async function createShop(slug: string, stock: Record<string, number> = {}): Promise<Shop> {
  const sql = owner();

  const [tenant] = await sql<{ id: string }[]>`
    INSERT INTO grip.tenants (name, slug, status)
    VALUES (${"Test " + slug}, ${slug}, 'active')
    RETURNING id`;
  const tenantId = tenant.id;

  const users: Record<string, string> = {};
  for (const role of ["service_advisor", "parts_advisor", "technician", "shop_admin"]) {
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
      VALUES (${tenantId}, ${`${role}@${slug}.test`}, 'x', ${role}, ${role}::grip.user_role)
      RETURNING id`;
    users[role] = u.id;
  }

  const [taxRate] = await sql<{ id: string }[]>`
    INSERT INTO grip.tax_rates (tenant_id, name, is_default)
    VALUES (${tenantId}, 'HST', true) RETURNING id`;
  await sql`
    INSERT INTO grip.tax_rate_components (tenant_id, tax_rate_id, name, rate_bps, sort_order)
    VALUES (${tenantId}, ${taxRate.id}, 'HST', 1300, 0)`;

  const [customer] = await sql<{ id: string }[]>`
    INSERT INTO grip.customers (tenant_id, display_name)
    VALUES (${tenantId}, 'Dave Mercer') RETURNING id`;
  const [vehicle] = await sql<{ id: string }[]>`
    INSERT INTO grip.vehicles (tenant_id, customer_id, year, make, model)
    VALUES (${tenantId}, ${customer.id}, 2017, 'Subaru', 'WRX') RETURNING id`;

  const defaults: Record<string, number> = { "BP-1234": 10, "ALT-7781": 1, "OF-0090": 50 };
  const quantities = { ...defaults, ...stock };

  const parts: Record<string, string> = {};
  for (const [sku, qty] of Object.entries(quantities)) {
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO grip.parts (tenant_id, sku, description, unit_cost, unit_price)
      VALUES (${tenantId}, ${sku}, ${sku + " part"}, 50.00, 100.00)
      RETURNING id`;
    parts[sku] = p.id;
    await sql`
      INSERT INTO grip.part_stock (part_id, tenant_id, qty_on_hand)
      VALUES (${p.id}, ${tenantId}, ${qty})`;
  }

  return { tenantId, users, parts, customerId: customer.id, vehicleId: vehicle.id, taxRateId: taxRate.id };
}

// In-process counter: parallel callers must not race on max(number)+1.
let woNumber = 1000;

export async function createWorkOrder(shop: Shop, status = "in_progress"): Promise<string> {
  const sql = owner();
  const n = ++woNumber;

  const [wo] = await sql<{ id: string }[]>`
    INSERT INTO grip.work_orders
      (tenant_id, number, customer_id, vehicle_id, status, tax_rate_id,
       service_advisor_id, opened_by)
    VALUES
      (${shop.tenantId}, ${n}, ${shop.customerId}, ${shop.vehicleId},
       ${status}::grip.work_order_status, ${shop.taxRateId},
       ${shop.users.service_advisor}, ${shop.users.service_advisor})
    RETURNING id`;
  return wo.id;
}

export async function stockOf(partId: string) {
  const [row] = await owner()<
    { qty_on_hand: number; qty_reserved: number }[]
  >`SELECT qty_on_hand, qty_reserved FROM grip.part_stock WHERE part_id = ${partId}`;
  return {
    onHand: row.qty_on_hand,
    reserved: row.qty_reserved,
    available: row.qty_on_hand - row.qty_reserved,
  };
}

export async function dropShops(...slugs: string[]) {
  await owner()`DELETE FROM grip.tenants WHERE slug = ANY(${slugs})`;
}
