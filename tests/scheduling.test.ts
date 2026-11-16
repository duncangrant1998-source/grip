/**
 * Scheduling: the one property that matters is that a bay or technician can
 * never be double-booked, even when two people book at the same instant.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  app, appAlt, owner, asTenant, assertAppRoleIsRestricted,
  createShop, closeAll, dropShops, type Shop,
} from "./helpers";

let shop: Shop;
let other: Shop;
let bay1: string;
let bay2: string;
let otherBay: string;
let tech1: string;
let tech2: string;
let otherTech: string;

type Row = Record<string, any>;
const as = <T>(role: string, fn: Parameters<typeof asTenant<T>>[2], s: Shop = shop) =>
  asTenant(app(), { tenantId: s.tenantId, userId: s.users[role] }, fn);

// Wall-clock times at the shop (America/Vancouver in these tests).
const DAY = "2030-03-12"; // a Tuesday, in PDT (UTC-7)

async function book(opts: {
  at: string; minutes?: number; bay?: string | null; tech?: string | null; concern?: string;
}) {
  const [r] = await as("service_advisor", (tx) => tx<Row[]>`
    SELECT grip.create_appointment(
      ${shop.customerId}, ${shop.vehicleId}, ${`${DAY} ${opts.at}`}::text::timestamp,
      ${opts.minutes ?? 60}, ${opts.bay === undefined ? bay1 : opts.bay},
      ${opts.tech === undefined ? null : opts.tech}, ${opts.concern ?? null}) AS id`);
  return r.id as string;
}

const status = async (id: string) =>
  (await owner()<Row[]>`SELECT status FROM grip.appointments WHERE id = ${id}`)[0].status as string;

beforeAll(async () => {
  await assertAppRoleIsRestricted();
  await dropShops("sc-shop", "sc-other");
  shop = await createShop("sc-shop");
  other = await createShop("sc-other");

  await owner()`INSERT INTO grip.tenant_settings (tenant_id, timezone, default_tax_rate_id)
                VALUES (${shop.tenantId}, 'America/Vancouver', ${shop.taxRateId})`;

  const mk = async (s: Shop, name: string) =>
    (await owner()<Row[]>`INSERT INTO grip.bays (tenant_id, name) VALUES (${s.tenantId}, ${name}) RETURNING id`)[0].id as string;
  bay1 = await mk(shop, "Bay 1");
  bay2 = await mk(shop, "Bay 2");
  otherBay = await mk(other, "Bay 1");

  const emp = async (s: Shop, name: string) =>
    (await owner()<Row[]>`INSERT INTO grip.employees (tenant_id, full_name) VALUES (${s.tenantId}, ${name}) RETURNING id`)[0].id as string;
  tech1 = await emp(shop, "Alex");
  tech2 = await emp(shop, "Pat");
  otherTech = await emp(other, "Other Tech");
});

afterAll(async () => {
  await dropShops("sc-shop", "sc-other");
  await closeAll();
});

beforeEach(async () => {
  await owner()`DELETE FROM grip.work_orders WHERE tenant_id = ${shop.tenantId}`;
  await owner()`DELETE FROM grip.appointments WHERE tenant_id = ${shop.tenantId}`;
});

describe("booking", () => {
  test("stores the shop's wall-clock time as the right instant", async () => {
    const id = await book({ at: "09:00" });
    const [a] = await owner()<Row[]>`
      SELECT to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS utc,
             to_char(ends_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS utc_end
      FROM grip.appointments WHERE id = ${id}`;
    // 09:00 PDT is 16:00 UTC.
    expect(a.utc).toBe("2030-03-12T16:00");
    expect(a.utc_end).toBe("2030-03-12T17:00");
  });

  test("the timezone is the shop's own setting, and daylight saving is respected", async () => {
    // Toronto observes daylight saving, so the same 09:00 is a different instant
    // in January (EST, UTC-5) and July (EDT, UTC-4). (Vancouver no longer shifts
    // its clocks, which is why this test does not use the default shop zone.)
    await owner()`UPDATE grip.tenant_settings SET timezone = 'America/Toronto' WHERE tenant_id = ${shop.tenantId}`;
    try {
      const utcOf = async (local: string) => {
        const [r] = await as("service_advisor", (tx) => tx<Row[]>`
          SELECT grip.create_appointment(${shop.customerId}, ${shop.vehicleId},
            ${local}::text::timestamp, 60, ${bay1}, NULL, NULL) AS id`);
        const [a] = await owner()<Row[]>`
          SELECT to_char(starts_at AT TIME ZONE 'UTC', 'HH24:MI') AS utc
          FROM grip.appointments WHERE id = ${r.id}`;
        return a.utc as string;
      };
      expect(await utcOf("2030-01-15 09:00")).toBe("14:00");
      expect(await utcOf("2030-07-16 09:00")).toBe("13:00");
    } finally {
      await owner()`UPDATE grip.tenant_settings SET timezone = 'America/Vancouver' WHERE tenant_id = ${shop.tenantId}`;
    }
  });

  test("the end is start plus the estimate", async () => {
    const id = await book({ at: "13:00", minutes: 150 });
    const [a] = await owner()<Row[]>`
      SELECT (extract(epoch FROM ends_at - starts_at) / 60)::int AS mins
      FROM grip.appointments WHERE id = ${id}`;
    expect(a.mins).toBe(150);
  });

  test("a bay and technician are optional", async () => {
    const id = await book({ at: "09:00", bay: null });
    expect(await status(id)).toBe("scheduled");
  });

  test("the vehicle must belong to the customer", async () => {
    const [c] = await owner()<Row[]>`INSERT INTO grip.customers (tenant_id, display_name) VALUES (${shop.tenantId}, 'Someone Else') RETURNING id`;
    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.create_appointment(${c.id}, ${shop.vehicleId}, ${`${DAY} 09:00`}::text::timestamp, 60, NULL, NULL, NULL)`))
      .rejects.toThrow(/does not belong/i);
  });

  test("rejects absurd durations", async () => {
    await expect(book({ at: "09:00", minutes: 2 })).rejects.toThrow(/between 5 minutes and 24 hours/i);
    await expect(book({ at: "09:00", minutes: 5000 })).rejects.toThrow(/between 5 minutes and 24 hours/i);
  });

  test("is recorded in the audit log against the person who booked it", async () => {
    const id = await book({ at: "09:00" });
    const [a] = await owner()<Row[]>`SELECT actor_user_id FROM grip.audit_log WHERE entity_id = ${id}`;
    expect(a.actor_user_id).toBe(shop.users.service_advisor);
  });
});

describe("a bay cannot be double-booked", () => {
  test("rejects an overlap, with a message naming what is in the way", async () => {
    await book({ at: "09:00", minutes: 120 });
    await expect(book({ at: "10:00" })).rejects.toThrow(/Bay 1 is already booked 9:00 AM – 11:00 AM/);
  });

  test.each([
    ["starts inside", "09:30", 60],
    ["ends inside", "08:30", 60],
    ["swallows it", "08:00", 240],
    ["identical", "09:00", 60],
  ])("rejects a booking that %s an existing one", async (_n, at, minutes) => {
    await book({ at: "09:00", minutes: 60 });
    await expect(book({ at, minutes })).rejects.toThrow(/already booked/i);
  });

  test("back-to-back is fine: one ends at 10:00, the next starts at 10:00", async () => {
    await book({ at: "09:00", minutes: 60 });
    await expect(book({ at: "10:00", minutes: 60 })).resolves.toBeTruthy();
    await expect(book({ at: "08:00", minutes: 60 })).resolves.toBeTruthy();
  });

  test("the same time in a different bay is fine", async () => {
    await book({ at: "09:00", bay: bay1 });
    await expect(book({ at: "09:00", bay: bay2 })).resolves.toBeTruthy();
  });

  test("cancelling frees the slot", async () => {
    const id = await book({ at: "09:00" });
    await as("service_advisor", (tx) => tx`SELECT grip.set_appointment_status(${id}, 'cancelled')`);
    await expect(book({ at: "09:00" })).resolves.toBeTruthy();
  });

  test("a no-show frees the slot", async () => {
    const id = await book({ at: "09:00" });
    await as("service_advisor", (tx) => tx`SELECT grip.set_appointment_status(${id}, 'no_show')`);
    await expect(book({ at: "09:30" })).resolves.toBeTruthy();
  });

  test("unassigned appointments do not block each other", async () => {
    await book({ at: "09:00", bay: null });
    await expect(book({ at: "09:00", bay: null })).resolves.toBeTruthy();
  });
});

describe("a technician cannot be in two places", () => {
  test("rejects the same tech in two bays at once", async () => {
    await book({ at: "09:00", bay: bay1, tech: tech1 });
    await expect(book({ at: "09:30", bay: bay2, tech: tech1 })).rejects.toThrow(/Alex is already booked/);
  });

  test("different technicians can work at the same time", async () => {
    await book({ at: "09:00", bay: bay1, tech: tech1 });
    await expect(book({ at: "09:00", bay: bay2, tech: tech2 })).resolves.toBeTruthy();
  });

  test("the same tech back to back is fine", async () => {
    await book({ at: "09:00", bay: bay1, tech: tech1 });
    await expect(book({ at: "10:00", bay: bay2, tech: tech1 })).resolves.toBeTruthy();
  });
});

describe("two people booking at the same instant", () => {
  test("exactly one of two simultaneous bookings for one bay wins", async () => {
    // Both transactions pass the friendly pre-check before either commits, so
    // only the exclusion constraint stands between them.
    const second = appAlt();
    try {
      const attempt = (sql: typeof second) =>
        asTenant(sql, { tenantId: shop.tenantId, userId: shop.users.service_advisor }, async (tx) => {
          const [r] = await tx<Row[]>`
            SELECT grip.create_appointment(${shop.customerId}, ${shop.vehicleId},
              ${`${DAY} 14:00`}::text::timestamp, 60, ${bay1}, NULL, NULL) AS id`;
          await tx`SELECT pg_sleep(0.2)`; // hold the transaction open so both overlap
          return r.id;
        });

      const results = await Promise.allSettled([attempt(app()), attempt(second)]);
      const won = results.filter((r) => r.status === "fulfilled");
      expect(won).toHaveLength(1);

      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      // 23P01 is exclusion_violation (or the friendly check if it lost the race to see the row).
      expect(String(lost.reason.message)).toMatch(/conflicting key value violates exclusion|already booked/i);

      const [{ n }] = await owner()<Row[]>`
        SELECT count(*)::int AS n FROM grip.appointments WHERE bay_id = ${bay1}`;
      expect(n).toBe(1);
    } finally {
      await second.end();
    }
  });
});

describe("rescheduling", () => {
  const update = (id: string, at: string, minutes = 60, bay: string | null = bay1, tech: string | null = null) =>
    as("service_advisor", (tx) => tx`
      SELECT grip.update_appointment(${id}, ${`${DAY} ${at}`}::text::timestamp, ${minutes}, ${bay}, ${tech}, 'moved')`);

  test("moving an appointment into its own old slot is not a conflict with itself", async () => {
    const id = await book({ at: "09:00", minutes: 60 });
    await expect(update(id, "09:30", 60)).resolves.toBeDefined();
  });

  test("cannot be moved on top of another", async () => {
    await book({ at: "09:00" });
    const id = await book({ at: "11:00" });
    await expect(update(id, "09:30")).rejects.toThrow(/already booked/i);
  });

  test("can be moved to a different bay", async () => {
    const id = await book({ at: "09:00", bay: bay1 });
    await book({ at: "09:00", bay: bay2 }).catch(() => {});
    await update(id, "13:00", 60, bay2);
    const [a] = await owner()<Row[]>`SELECT bay_id FROM grip.appointments WHERE id = ${id}`;
    expect(a.bay_id).toBe(bay2);
  });

  test("a finished appointment cannot be changed", async () => {
    const id = await book({ at: "09:00" });
    for (const to of ["arrived", "in_progress", "completed"]) {
      await as("service_advisor", (tx) => tx`SELECT grip.set_appointment_status(${id}, ${to}::grip.appointment_status)`);
    }
    await expect(update(id, "10:00")).rejects.toThrow(/cannot be changed/i);
  });
});

describe("status", () => {
  const set = (id: string, to: string) =>
    as("service_advisor", (tx) => tx`SELECT grip.set_appointment_status(${id}, ${to}::grip.appointment_status)`);

  test("walks scheduled > confirmed > arrived > in progress > completed", async () => {
    const id = await book({ at: "09:00" });
    for (const to of ["confirmed", "arrived", "in_progress", "completed"]) {
      await set(id, to);
      expect(await status(id)).toBe(to);
    }
  });

  test.each([
    ["scheduled", "in_progress"],
    ["scheduled", "completed"],
  ])("cannot jump from %s to %s", async (_from, to) => {
    const id = await book({ at: "09:00" });
    await expect(set(id, to)).rejects.toThrow(/cannot be marked/i);
  });

  test("a cancelled appointment stays cancelled", async () => {
    const id = await book({ at: "09:00" });
    await set(id, "cancelled");
    await expect(set(id, "arrived")).rejects.toThrow(/cannot be marked/i);
  });
});

describe("turning an appointment into a work order", () => {
  const convert = (id: string) =>
    as("service_advisor", (tx) => tx<Row[]>`SELECT grip.convert_appointment_to_work_order(${id}) AS wo`);

  test("creates a quote for the same customer, vehicle and concern, linked back", async () => {
    const id = await book({ at: "09:00", concern: "Squealing brakes", tech: tech1 });
    const [r] = await convert(id);

    const [wo] = await owner()<Row[]>`SELECT * FROM grip.work_orders WHERE id = ${r.wo}`;
    expect(wo.status).toBe("quote");
    expect(wo.customer_id).toBe(shop.customerId);
    expect(wo.vehicle_id).toBe(shop.vehicleId);
    expect(wo.concern).toBe("Squealing brakes");
    expect(wo.appointment_id).toBe(id);
  });

  test("marks the customer as arrived", async () => {
    const id = await book({ at: "09:00" });
    await convert(id);
    expect(await status(id)).toBe("arrived");
  });

  test("an appointment becomes at most one work order", async () => {
    const id = await book({ at: "09:00" });
    await convert(id);
    await expect(convert(id)).rejects.toThrow(/already has a work order/i);
  });

  test("a cancelled appointment cannot become a work order", async () => {
    const id = await book({ at: "09:00" });
    await as("service_advisor", (tx) => tx`SELECT grip.set_appointment_status(${id}, 'cancelled')`);
    await expect(convert(id)).rejects.toThrow(/cannot become a work order/i);
  });

  test("starting and completing the job carries through to the appointment", async () => {
    const id = await book({ at: "09:00" });
    const [r] = await convert(id);
    const go = (to: string) =>
      as("service_advisor", (tx) => tx`SELECT grip.transition_work_order(${r.wo}, ${to}::grip.work_order_status)`);

    await go("approved");
    await go("in_progress");
    expect(await status(id)).toBe("in_progress");
    await go("completed");
    expect(await status(id)).toBe("completed");
  });

  test("the conversion is audited against both records", async () => {
    const id = await book({ at: "09:00" });
    await convert(id);
    const [a] = await owner()<Row[]>`
      SELECT 1 FROM grip.audit_log WHERE entity_id = ${id} AND action = 'appointment.converted'`;
    expect(a).toBeTruthy();
  });
});

describe("tenant isolation", () => {
  test("cannot book another shop's bay or technician", async () => {
    await expect(book({ at: "09:00", bay: otherBay })).rejects.toThrow(/bay not found/i);
    await expect(book({ at: "09:00", bay: bay1, tech: otherTech })).rejects.toThrow(/technician not found/i);
  });

  test("cannot book another shop's customer", async () => {
    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.create_appointment(${other.customerId}, ${other.vehicleId},
        ${`${DAY} 09:00`}::text::timestamp, 60, NULL, NULL, NULL)`))
      .rejects.toThrow(/customer not found/i);
  });

  test("two shops can book their own bays at the same time", async () => {
    await book({ at: "09:00" });
    await expect(as("service_advisor", (tx) => tx`
      SELECT grip.create_appointment(${other.customerId}, ${other.vehicleId},
        ${`${DAY} 09:00`}::text::timestamp, 60, ${otherBay}, NULL, NULL)`, other))
      .resolves.toBeDefined();
  });

  test("another shop cannot see, move or cancel this shop's appointments", async () => {
    const id = await book({ at: "09:00" });
    const seen = await as("shop_admin", (tx) => tx<Row[]>`SELECT id FROM grip.appointments WHERE id = ${id}`, other);
    expect(seen).toHaveLength(0);
    await expect(as("shop_admin", (tx) => tx`SELECT grip.set_appointment_status(${id}, 'cancelled')`, other))
      .rejects.toThrow(/not found/i);
    await expect(as("shop_admin", (tx) => tx`SELECT grip.convert_appointment_to_work_order(${id})`, other))
      .rejects.toThrow(/not found/i);
    expect(await status(id)).toBe("scheduled");
  });
});

describe("removing a bay", () => {
  /** A bay of its own, so these do not disturb the shared bay1 / bay2. */
  const spare = async (name: string, s: Shop = shop) =>
    (await owner()<Row[]>`
      INSERT INTO grip.bays (tenant_id, name) VALUES (${s.tenantId}, ${name}) RETURNING id`)[0].id as string;

  const del = (id: string, s: Shop = shop) =>
    as("shop_admin", (tx) => tx`SELECT grip.delete_bay(${id})`, s);

  const exists = async (id: string) =>
    (await owner()<Row[]>`SELECT 1 FROM grip.bays WHERE id = ${id}`).length === 1;

  test("a bay nothing was ever booked into is deleted outright", async () => {
    const id = await spare("Typo Bya");
    await del(id);
    expect(await exists(id)).toBe(false);
  });

  test("the deletion is written to the audit trail", async () => {
    const id = await spare("Audit Bay");
    await del(id);
    const [row] = await owner()<Row[]>`
      SELECT actor_user_id, diff FROM grip.audit_log
      WHERE entity_id = ${id} AND action = 'bay.deleted'`;
    expect(row.actor_user_id).toBe(shop.users.shop_admin);
    expect(row.diff).toMatchObject({ name: "Audit Bay" });
  });

  test("a bay with upcoming work is refused, and says how much", async () => {
    const id = await spare("Busy Bay");
    await book({ at: "09:00", bay: id });
    await expect(del(id)).rejects.toThrow(/Move or cancel the 1 upcoming appointment in this bay first/);
    expect(await exists(id)).toBe(true);
  });

  test("a bay with only past work is kept, so the work keeps its bay", async () => {
    const id = await spare("Retired Bay");
    const appt = await book({ at: "09:00", bay: id });
    await owner()`
      UPDATE grip.appointments SET starts_at = now() - interval '30 days', status = 'completed'
      WHERE id = ${appt}`;

    await expect(del(id)).rejects.toThrow(/Retire it instead/);
    expect(await exists(id)).toBe(true);

    // Retiring works, and the old appointment still points at it.
    await as("shop_admin", (tx) => tx`UPDATE grip.bays SET is_active = false WHERE id = ${id}`);
    const [a] = await owner()<Row[]>`SELECT bay_id FROM grip.appointments WHERE id = ${appt}`;
    expect(a.bay_id).toBe(id);
  });

  test("a cancelled appointment still counts as history", async () => {
    const id = await spare("Cancelled Bay");
    const appt = await book({ at: "11:00", bay: id });
    await as("service_advisor", (tx) => tx`SELECT grip.set_appointment_status(${appt}, 'cancelled')`);
    await expect(del(id)).rejects.toThrow(/Retire it instead/);
  });

  test("another shop's bay cannot be deleted", async () => {
    const id = await spare("Theirs", other);
    await expect(del(id)).rejects.toThrow(/bay not found/i);
    expect(await exists(id)).toBe(true);
  });
});
