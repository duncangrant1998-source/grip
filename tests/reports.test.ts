/**
 * Reports. These run against hand-built data with known answers, so every figure
 * can be checked by arithmetic:
 *
 *   Shop timezone America/Vancouver (UTC-7 in March 2030).
 *
 *   WO A  invoiced 03-12 10:00  labour $300 (tech Alex 3.0 billed / 2.0 actual @ $100)
 *                               parts   $200 (2 x $100, cost $60 each = $120)  tax $60
 *   WO B  paid     03-12 23:30  labour $100 (tech Pat 1.0 billed / 1.25 actual)  tax $12
 *   WO C  invoiced 03-13 00:30  labour  $80, tax $9.60                           (next local day)
 *   quote / in_progress / cancelled orders                                       (count for nothing)
 *   counter sale completed 03-12 12:00   subtotal $50, tax $6, cost $20
 *   counter sale still open                                                      (counts for nothing)
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  app, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let alex: string;
let pat: string;
let nonTech: string;

type Row = Record<string, any>;
const as = <T>(fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users.shop_admin }, fn);

const revenue = (from: string, to: string, grain = "day", s: Shop = shop) =>
  as((tx) => tx<Row[]>`
    SELECT * FROM grip.report_revenue(${from}::text::date, ${to}::text::date, ${grain})`, s);
const labourCost = (from: string, to: string, grain = "day") =>
  as((tx) => tx<Row[]>`
    SELECT * FROM grip.report_labour_cost(${from}::text::date, ${to}::text::date, ${grain})`);
const techs = (from: string, to: string, s: Shop = shop) =>
  as((tx) => tx<Row[]>`SELECT * FROM grip.report_technicians(${from}::text::date, ${to}::text::date)`, s);
const num = (v: unknown) => Number(v);

let woNumber = 5000;
async function wo(s: Shop, o: {
  status: string; at?: string; labour?: number; parts?: number; tax?: number;
  lines?: { tech: string; billed: number; actual: number; rate: number }[];
  partLines?: { qty: number; price: number; cost: number }[];
}) {
  const [w] = await owner()<Row[]>`
    INSERT INTO grip.work_orders
      (tenant_id, number, customer_id, vehicle_id, status, labour_subtotal, parts_subtotal,
       subtotal, tax_total, total, invoiced_at)
    VALUES
      (${s.tenantId}, ${++woNumber}, ${s.customerId}, ${s.vehicleId}, ${o.status}::grip.work_order_status,
       ${o.labour ?? 0}, ${o.parts ?? 0}, ${(o.labour ?? 0) + (o.parts ?? 0)}, ${o.tax ?? 0},
       ${(o.labour ?? 0) + (o.parts ?? 0) + (o.tax ?? 0)},
       ${o.at ?? null}::text::timestamptz)
    RETURNING id`;
  for (const l of o.lines ?? []) {
    await owner()`
      INSERT INTO grip.work_order_labour_lines
        (tenant_id, work_order_id, description, billed_hours, actual_hours, rate, tech_id)
      VALUES (${s.tenantId}, ${w.id}, 'job', ${l.billed}, ${l.actual}, ${l.rate}, ${l.tech})`;
  }
  for (const p of o.partLines ?? []) {
    await owner()`
      INSERT INTO grip.work_order_part_lines
        (tenant_id, work_order_id, part_id, description, qty, unit_cost, unit_price)
      VALUES (${s.tenantId}, ${w.id}, ${s.parts["BP-1234"]}, 'part', ${p.qty}, ${p.cost}, ${p.price})`;
  }
  return w.id as string;
}

async function sale(s: Shop, status: string, at: string | null, subtotal: number, tax: number, cost: number) {
  const [r] = await owner()<Row[]>`
    INSERT INTO grip.counter_sales (tenant_id, number, status, subtotal, tax_total, total, completed_at)
    VALUES (${s.tenantId}, ${++woNumber}, ${status}, ${subtotal}, ${tax}, ${subtotal + tax}, ${at}::text::timestamptz)
    RETURNING id`;
  await owner()`
    INSERT INTO grip.counter_sale_lines (tenant_id, counter_sale_id, part_id, description, qty, unit_cost, unit_price)
    VALUES (${s.tenantId}, ${r.id}, ${s.parts["BP-1234"]}, 'x', 1, ${cost}, ${subtotal})`;
}

async function clock(s: Shop, emp: string, inUtc: string, outUtc: string | null) {
  await owner()`
    INSERT INTO grip.time_entries (tenant_id, employee_id, clock_in, clock_out)
    VALUES (${s.tenantId}, ${emp}, ${inUtc}::text::timestamptz, ${outUtc}::text::timestamptz)`;
}

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("rp-shop", "rp-other");
  shop = await createShop("rp-shop");
  other = await createShop("rp-other");
  await owner()`INSERT INTO grip.tenant_settings (tenant_id, timezone) VALUES (${shop.tenantId}, 'America/Vancouver')`;

  const emp = async (s: Shop, name: string, rate: number, tech: boolean) =>
    (await owner()<Row[]>`
      INSERT INTO grip.employees (tenant_id, full_name, hourly_rate, is_technician)
      VALUES (${s.tenantId}, ${name}, ${rate}, ${tech}) RETURNING id`)[0].id as string;
  alex = await emp(shop, "Alex", 40, true);
  pat = await emp(shop, "Pat", 30, true);
  nonTech = await emp(shop, "Counter Clerk", 25, false);

  // March 2030 is PDT (UTC-7): local 10:00 = 17:00Z, local 23:30 = 06:30Z next day.
  await wo(shop, {
    status: "invoiced", at: "2030-03-12T17:00:00Z", labour: 300, parts: 200, tax: 60,
    lines: [{ tech: alex, billed: 3, actual: 2, rate: 100 }],
    partLines: [{ qty: 2, price: 100, cost: 60 }],
  });
  await wo(shop, {
    status: "paid", at: "2030-03-13T06:30:00Z", labour: 100, tax: 12,
    lines: [{ tech: pat, billed: 1, actual: 1.25, rate: 100 }],
  });
  await wo(shop, {
    status: "invoiced", at: "2030-03-13T07:30:00Z", labour: 80, tax: 9.6,
    lines: [{ tech: alex, billed: 0.8, actual: 0.8, rate: 100 }],
  });
  await wo(shop, { status: "quote", labour: 999, parts: 999 });
  await wo(shop, { status: "in_progress", labour: 999, parts: 999 });
  await wo(shop, { status: "cancelled", labour: 999, parts: 999 });
  await sale(shop, "completed", "2030-03-12T19:00:00Z", 50, 6, 20);
  await sale(shop, "open", null, 999, 0, 0);

  // On the clock, 03-12 local.
  await clock(shop, alex, "2030-03-12T15:00:00Z", "2030-03-12T23:00:00Z");   // 8 h @ $40
  await clock(shop, pat, "2030-03-12T16:00:00Z", "2030-03-12T20:00:00Z");    // 4 h @ $30
  await clock(shop, nonTech, "2030-03-12T15:00:00Z", "2030-03-12T23:00:00Z"); // not a technician
  await clock(shop, alex, "2030-03-13T15:00:00Z", null);                      // still on the clock

  // Another shop with its own money, which must never appear in this one's reports.
  await wo(other, { status: "invoiced", at: "2030-03-12T17:00:00Z", labour: 5000, parts: 5000, tax: 1200 });
});

afterAll(async () => {
  await dropShops("rp-shop", "rp-other");
  await closeAll();
});

describe("revenue", () => {
  test("daily: labour and parts, tax kept apart, bucketed by the shop's local date", async () => {
    const rows = await revenue("2030-03-12", "2030-03-14");
    const day12 = rows.find((r) => r.period === "2030-03-12")!;
    const day13 = rows.find((r) => r.period === "2030-03-13")!;

    // 03-12: WO A + WO B (23:30 local) + the counter sale.
    expect(num(day12.labour)).toBe(400);
    expect(num(day12.parts)).toBe(250);   // 200 from WO A + 50 counter
    expect(num(day12.tax)).toBe(78);      // 60 + 12 + 6
    expect(num(day12.parts_cost)).toBe(140); // 120 + 20
    expect(num(day12.billed_hours)).toBe(4);
    expect(Number(day12.documents)).toBe(3);

    // WO C was invoiced at 00:30 local on 03-13, even though it is 07:30Z.
    expect(num(day13.labour)).toBe(80);
    expect(num(day13.parts)).toBe(0);
    expect(Number(day13.documents)).toBe(1);
  });

  test("quotes, work in progress, cancelled orders and open sales count for nothing", async () => {
    const rows = await revenue("2030-03-01", "2030-04-01", "month");
    expect(rows).toHaveLength(1);
    expect(num(rows[0].labour)).toBe(480);   // 300 + 100 + 80, never the 999s
    expect(num(rows[0].parts)).toBe(250);
  });

  test("groups by week (Monday start) and by month", async () => {
    const weeks = await revenue("2030-03-01", "2030-04-01", "week");
    expect(weeks.map((w) => w.period)).toEqual(["2030-03-11"]); // Monday of that week
    const months = await revenue("2030-03-01", "2030-04-01", "month");
    expect(months[0].period).toBe("2030-03-01");
  });

  test("the end of the range is exclusive and the start inclusive, in shop time", async () => {
    // WO C is 03-13 00:30 local, so a range ending 03-13 must leave it out.
    const before = await revenue("2030-03-12", "2030-03-13");
    expect(before.reduce((s, r) => s + num(r.labour), 0)).toBe(400);
    // And one starting 03-13 must include it and nothing from 03-12.
    const after = await revenue("2030-03-13", "2030-03-14");
    expect(after.reduce((s, r) => s + num(r.labour), 0)).toBe(80);
  });

  test("an empty range is simply empty", async () => {
    expect(await revenue("2030-06-01", "2030-06-08")).toHaveLength(0);
  });

  test("the same instant lands on a different day in a different timezone", async () => {
    // 2030-03-13T04:30Z is 21:30 on 03-12 in Vancouver but 00:30 on 03-13 in Toronto.
    await wo(shop, { status: "invoiced", at: "2030-03-13T04:30:00Z", labour: 1000 });
    const dayOf = async () => {
      const rows = await revenue("2030-03-12", "2030-03-14");
      return rows.find((r) => num(r.labour) === 1400 || num(r.labour) === 1080)?.period;
    };
    expect(await dayOf()).toBe("2030-03-12"); // Vancouver: 400 + 1000

    await owner()`UPDATE grip.tenant_settings SET timezone = 'America/Toronto' WHERE tenant_id = ${shop.tenantId}`;
    try {
      const rows = await revenue("2030-03-12", "2030-03-15");
      const total = rows.reduce((s, r) => s + num(r.labour), 0);
      expect(total).toBeGreaterThan(0);
      // In Toronto the 1000 belongs to 03-13, so 03-12 no longer holds it.
      const d12 = rows.find((r) => r.period === "2030-03-12");
      expect(num(d12?.labour ?? 0)).toBeLessThan(1000);
    } finally {
      await owner()`UPDATE grip.tenant_settings SET timezone = 'America/Vancouver' WHERE tenant_id = ${shop.tenantId}`;
      await owner()`DELETE FROM grip.work_orders WHERE tenant_id = ${shop.tenantId} AND labour_subtotal = 1000`;
    }
  });

  test("another shop's money is never included", async () => {
    const mine = await revenue("2030-03-12", "2030-03-13");
    expect(mine.reduce((s, r) => s + num(r.labour) + num(r.parts), 0)).toBe(650); // not 10,650
    const theirs = await revenue("2030-03-12", "2030-03-13", "day", other);
    expect(theirs.reduce((s, r) => s + num(r.labour) + num(r.parts), 0)).toBe(10000);
  });
});

describe("labour cost", () => {
  test("clocked technician time times their rate; non-technicians and open entries excluded", async () => {
    const rows = await labourCost("2030-03-12", "2030-03-14");
    const d = rows.find((r) => r.period === "2030-03-12")!;
    expect(num(d.clocked_hours)).toBe(12);     // Alex 8 + Pat 4, not the clerk's 8
    expect(num(d.payroll_cost)).toBe(440);     // 8 x 40 + 4 x 30
    expect(rows.find((r) => r.period === "2030-03-13")).toBeUndefined(); // open entry not counted yet
  });
});

describe("technicians", () => {
  test("billed, actual and clocked hours with both ratios computable", async () => {
    const rows = await techs("2030-03-12", "2030-03-14");
    const a = rows.find((r) => r.full_name === "Alex")!;
    const p = rows.find((r) => r.full_name === "Pat")!;

    expect(num(a.billed_hours)).toBe(3.8);       // 3.0 + 0.8
    expect(num(a.actual_hours)).toBe(2.8);       // 2.0 + 0.8
    expect(num(a.labour_revenue)).toBe(380);
    expect(num(a.clocked_hours)).toBe(8);
    expect(num(a.payroll_cost)).toBe(320);

    expect(num(p.billed_hours)).toBe(1);
    expect(num(p.actual_hours)).toBe(1.25);
    expect(num(p.clocked_hours)).toBe(4);

    // Efficiency (billed / actual): Alex beat book time, Pat was slower than it.
    expect(num(a.billed_hours) / num(a.actual_hours)).toBeGreaterThan(1);
    expect(num(p.billed_hours) / num(p.actual_hours)).toBeLessThan(1);
    // Productivity (billed / clocked) is a different, lower number.
    expect(num(a.billed_hours) / num(a.clocked_hours)).toBeCloseTo(0.475, 3);
  });

  test("only technicians are listed", async () => {
    const rows = await techs("2030-03-12", "2030-03-14");
    expect(rows.map((r) => r.full_name).sort()).toEqual(["Alex", "Pat"]);
  });

  test("a straight-time line reads 100% by construction", async () => {
    const rows = await techs("2030-03-13", "2030-03-14");
    const a = rows.find((r) => r.full_name === "Alex")!;
    expect(num(a.billed_hours)).toBe(num(a.actual_hours));
  });

  test("another shop's technicians are not shown", async () => {
    const rows = await techs("2030-03-12", "2030-03-14", other);
    expect(rows.map((r) => r.full_name)).not.toContain("Alex");
  });
});

describe("projection", () => {
  test("combines month-to-date, the trailing 28-day average, and work already in the building", async () => {
    await owner()`DELETE FROM grip.work_orders WHERE tenant_id = ${shop.tenantId}`;
    await owner()`DELETE FROM grip.counter_sales WHERE tenant_id = ${shop.tenantId}`;

    await wo(shop, { status: "invoiced", at: new Date().toISOString(), labour: 100, parts: 100 });
    await wo(shop, { status: "invoiced", at: new Date(Date.now() - 10 * 864e5).toISOString(), labour: 400 });
    await wo(shop, { status: "invoiced", at: new Date(Date.now() - 60 * 864e5).toISOString(), labour: 5000 }); // too old
    await wo(shop, { status: "in_progress", labour: 300, parts: 50 });
    await wo(shop, { status: "approved", labour: 100 });
    await wo(shop, { status: "quote", labour: 700 });

    const [p] = await as((tx) => tx<Row[]>`SELECT * FROM grip.report_projection()`);

    expect(num(p.trailing_28)).toBe(600);                 // today's 200 + 400, never the 5000
    expect(num(p.avg_daily)).toBeCloseTo(600 / 28, 2);
    expect(num(p.projected_month)).toBeCloseTo(
      num(p.mtd_revenue) + (600 / 28) * Number(p.days_remaining), 1);
    expect(num(p.mtd_revenue)).toBeGreaterThanOrEqual(200);

    expect(Number(p.wip_orders)).toBe(2);
    expect(num(p.wip_value)).toBe(450);
    expect(Number(p.quote_orders)).toBe(1);
    expect(num(p.quote_value)).toBe(700);
  });

  test("does not look at another shop", async () => {
    const [p] = await as((tx) => tx<Row[]>`SELECT * FROM grip.report_projection()`, other);
    expect(Number(p.wip_orders)).toBe(0);
    expect(num(p.trailing_28)).toBe(0);
  });
});
