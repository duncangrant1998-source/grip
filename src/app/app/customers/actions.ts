"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inShop } from "@/lib/auth";
import { runAction, redirect, type ActionState } from "@/lib/action";
import { parseCsv, withHeaders } from "@/lib/csv";
import { can } from "@/lib/permissions";

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const customerSchema = z.object({
  display_name: z.string().trim().min(1, "Enter a name.").max(120),
  phone: text(40),
  email: z.string().trim().max(254).optional().transform((v) => v || null)
    .refine((v) => v === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "That email doesn't look right."),
  address_line1: text(120),
  city: text(80),
  region: text(40),
  postal_code: text(20),
  notes: text(1000),
  tax_rate_id: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  exempt_reason: z.preprocess((v) => (v === "" || v == null ? undefined : v),
    z.enum(["status_card", "government", "resale", "export", "internal", "other"]).optional()),
  exempt_reference: text(60),
  exempt_expires_on: z.string().trim().optional()
    .transform((v) => v || null)
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter the expiry as a date."),
}).refine(
  (c) => !c.exempt_reason
    || !["status_card", "government", "resale"].includes(c.exempt_reason)
    || !!c.exempt_reference,
  { message: "That exemption needs the card, account or HST number recorded with it." },
);

function firstError(parsed: { success: false; error: z.ZodError }): ActionState {
  return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
}

export async function createCustomer(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = Object.fromEntries(form);
  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) return firstError(parsed);
  const c = parsed.data;
  const next = String(form.get("next") ?? "");

  // The customer's car can go in with the account. Leave the vehicle boxes empty to add it later.
  const wantsVehicle = ["v_year", "v_make", "v_model", "v_trim", "v_vin", "v_plate", "v_mileage"]
    .some((k) => String(raw[k] ?? "").trim() !== "");
  const v = vehicleSchema.safeParse({
    customer_id: "00000000-0000-0000-0000-000000000000",
    year: raw.v_year ?? "", make: raw.v_make ?? "", model: raw.v_model ?? "", trim: raw.v_trim ?? "",
    vin: raw.v_vin ?? "", plate: raw.v_plate ?? "", current_mileage: raw.v_mileage ?? "",
  });
  if (wantsVehicle && !v.success) return firstError(v);
  if (wantsVehicle && v.success && !v.data.make && !v.data.model && !v.data.vin) {
    return { error: "Enter at least a make, model or VIN for the vehicle, or leave the vehicle empty." };
  }

  return runAction("customers.edit", async (session) => {
    const { row, vehicleId } = await inShop(session, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO grip.customers
          (tenant_id, display_name, phone, email, address_line1, city, region,
           postal_code, notes, tax_rate_id, exempt_reason, exempt_reference, exempt_expires_on)
        VALUES
          (${session.tenantId}, ${c.display_name}, ${c.phone}, ${c.email}, ${c.address_line1},
           ${c.city}, ${c.region}, ${c.postal_code}, ${c.notes}, ${c.tax_rate_id},
           ${c.exempt_reason ?? null}::grip.exempt_reason, ${c.exempt_reference},
           ${c.exempt_expires_on}::date)
        RETURNING id`;
      let vehicleId: string | null = null;
      if (wantsVehicle && v.success) {
        const [veh] = await tx<{ id: string }[]>`
          INSERT INTO grip.vehicles
            (tenant_id, customer_id, year, make, model, trim, vin, plate, current_mileage)
          VALUES (${session.tenantId}, ${row.id}, ${v.data.year}, ${v.data.make}, ${v.data.model},
                  ${v.data.trim}, ${v.data.vin}, ${v.data.plate}, ${v.data.current_mileage})
          RETURNING id`;
        vehicleId = veh.id;
      }
      return { row, vehicleId };
    });

    revalidatePath("/app/customers");
    revalidatePath("/app", "layout");
    redirect(next === "order"
      ? `/app/orders/new?customer=${row.id}${vehicleId ? `&vehicle=${vehicleId}` : ""}`
      : `/app/customers/${row.id}${vehicleId ? `?vehicle=${vehicleId}` : ""}`);
  }).then((r) =>
    r.error === "That already exists." ? { error: "A vehicle with that VIN is already on file." } : r,
  );
}

export async function updateCustomer(_prev: ActionState, form: FormData): Promise<ActionState> {
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return { error: "Unknown customer." };
  const parsed = customerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstError(parsed);
  const c = parsed.data;

  return runAction("customers.edit", async (session) => {
    await inShop(session, (tx) => tx`
      UPDATE grip.customers SET
        display_name = ${c.display_name}, phone = ${c.phone}, email = ${c.email},
        address_line1 = ${c.address_line1}, city = ${c.city}, region = ${c.region},
        postal_code = ${c.postal_code}, notes = ${c.notes}, tax_rate_id = ${c.tax_rate_id},
        exempt_reason = ${c.exempt_reason ?? null}::grip.exempt_reason,
        exempt_reference = ${c.exempt_reference},
        exempt_expires_on = ${c.exempt_expires_on}::date
      WHERE id = ${id.data}`);
    revalidatePath(`/app/customers/${id.data}`);
    revalidatePath("/app", "layout");
  });
}

const vehicleSchema = z.object({
  customer_id: z.string().uuid(),
  year: z.string().trim().optional().transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1900 && v <= new Date().getFullYear() + 2),
      "Enter a valid model year."),
  make: text(60),
  model: text(60),
  trim: text(60),
  vin: z.string().trim().toUpperCase().optional().transform((v) => v || null)
    // 17 characters, no I, O or Q — they are never used because they read as 1 and 0.
    .refine((v) => v === null || /^[A-HJ-NPR-Z0-9]{17}$/.test(v),
      "A VIN is 17 characters and never contains I, O or Q."),
  plate: text(20),
  current_mileage: z.string().trim().optional().transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0), "Enter a valid mileage."),
});

export async function addVehicle(_prev: ActionState, form: FormData): Promise<ActionState> {
  const parsed = vehicleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return firstError(parsed);
  const v = parsed.data;
  if (!v.make && !v.model && !v.vin) return { error: "Enter at least a make, model or VIN." };

  return runAction("customers.edit", async (session) => {
    await inShop(session, async (tx) => {
      // Only attach to a customer this shop actually has; RLS hides other shops'.
      const [owner] = await tx`SELECT 1 FROM grip.customers WHERE id = ${v.customer_id}`;
      if (!owner) throw Object.assign(new Error("Customer not found."), { code: "P0001" });

      await tx`
        INSERT INTO grip.vehicles
          (tenant_id, customer_id, year, make, model, trim, vin, plate, current_mileage)
        VALUES
          (${session.tenantId}, ${v.customer_id}, ${v.year}, ${v.make}, ${v.model}, ${v.trim},
           ${v.vin}, ${v.plate}, ${v.current_mileage})`;
    });
    revalidatePath(`/app/customers/${v.customer_id}`);
    revalidatePath("/app", "layout");
  }).then((r) =>
    // A VIN is unique per shop; say so plainly instead of "already exists".
    r.error === "That already exists." ? { error: "A vehicle with that VIN is already on file." } : r,
  );
}

// --- CSV import -----------------------------------------------------------------------

/** What an import did, so the shop can see it worked before trusting it. */
export type ImportState = ActionState & {
  report?: {
    customersAdded: number;
    customersMatched: number;
    vehiclesAdded: number;
    skipped: { row: number; reason: string }[];
  };
};

const MAX_ROWS = 5000;

/**
 * Loads customers and vehicles from a spreadsheet, in the same shape the
 * exporter writes: one row per vehicle, the customer repeated.
 *
 * It is deliberately forgiving about the file and strict about the data. A row
 * that cannot be used is reported with its line number and the rest still go
 * in, because a shop importing two thousand customers should not have the lot
 * rejected over one bad VIN. Customers already on file are matched by name and
 * are never overwritten — an import only ever adds.
 */
export async function importCustomers(_prev: ImportState, form: FormData): Promise<ImportState> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file first." };
  if (file.size > 5_000_000) return { error: "That file is larger than 5 MB." };

  const rows = withHeaders(parseCsv(await file.text()));
  if (rows.length === 0) return { error: "That file has no rows under its heading." };
  if (rows.length > MAX_ROWS) return { error: `That file has more than ${MAX_ROWS} rows. Split it up.` };
  if (!("name" in rows[0])) {
    return { error: "The first row must be a heading, and must include a 'name' column." };
  }

  const skipped: { row: number; reason: string }[] = [];
  let customersAdded = 0;
  let customersMatched = 0;
  let vehiclesAdded = 0;

  const result = await runAction("customers.edit", async (session) => {
    await inShop(session, async (tx) => {
      // Name -> id, for customers already on file and ones added as we go, so a
      // customer repeated down the file is created exactly once.
      const existing = await tx<{ id: string; display_name: string }[]>`
        SELECT id, display_name FROM grip.customers`;
      const byName = new Map(existing.map((c) => [c.display_name.trim().toLowerCase(), c.id]));
      const matched = new Set<string>();   // counted once, however often they repeat

      const vins = await tx<{ vin: string }[]>`
        SELECT upper(vin) AS vin FROM grip.vehicles WHERE vin IS NOT NULL`;
      const seenVins = new Set(vins.map((v) => v.vin));

      for (const [i, r] of rows.entries()) {
        const line = i + 2; // the heading is line 1
        const name = (r.name ?? "").trim();
        if (!name) { skipped.push({ row: line, reason: "no name" }); continue; }

        const key = name.toLowerCase();
        let customerId = byName.get(key);

        if (!customerId) {
          const c = customerSchema.safeParse({
            display_name: name,
            email: r.email ?? "", phone: r.phone ?? "",
            address_line1: r.address ?? "", city: r.city ?? "",
            region: r.province ?? r.region ?? "", postal_code: r.postalcode ?? "",
            notes: r.notes ?? "", tax_rate_id: "",
          });
          if (!c.success) {
            skipped.push({ row: line, reason: c.error.issues[0]?.message ?? "invalid customer" });
            continue;
          }
          const d = c.data;
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO grip.customers
              (tenant_id, display_name, phone, email, address_line1, city, region, postal_code, notes)
            VALUES (${session.tenantId}, ${d.display_name}, ${d.phone}, ${d.email},
                    ${d.address_line1}, ${d.city}, ${d.region}, ${d.postal_code}, ${d.notes})
            RETURNING id`;
          customerId = row.id;
          byName.set(key, customerId);
          customersAdded++;
        } else if (!matched.has(key)) {
          matched.add(key);
          customersMatched++;
        }

        // The vehicle half of the row is optional.
        const hasVehicle = [r.vehiclemake, r.vehiclemodel, r.vehicletrim, r.vehiclevin, r.vehicleyear, r.vehicleplate]
          .some((v) => (v ?? "").trim() !== "");
        if (!hasVehicle) continue;

        const v = vehicleSchema.safeParse({
          customer_id: customerId,
          year: r.vehicleyear ?? "", make: r.vehiclemake ?? "", model: r.vehiclemodel ?? "", trim: r.vehicletrim ?? "",
          vin: r.vehiclevin ?? "", plate: r.vehicleplate ?? "", current_mileage: r.vehiclemileage ?? "",
        });
        if (!v.success) {
          skipped.push({ row: line, reason: v.error.issues[0]?.message ?? "invalid vehicle" });
          continue;
        }
        if (v.data.vin && seenVins.has(v.data.vin)) {
          skipped.push({ row: line, reason: `VIN ${v.data.vin} is already on file` });
          continue;
        }

        await tx`
          INSERT INTO grip.vehicles
            (tenant_id, customer_id, year, make, model, trim, vin, plate, current_mileage)
          VALUES (${session.tenantId}, ${customerId}, ${v.data.year}, ${v.data.make},
                  ${v.data.model}, ${v.data.trim}, ${v.data.vin}, ${v.data.plate}, ${v.data.current_mileage})`;
        if (v.data.vin) seenVins.add(v.data.vin);
        vehiclesAdded++;
      }
    });

    revalidatePath("/app/customers");
  });

  if (result.error) return result;
  // Only the first 50 problems: a wholly wrong file would otherwise fill the page.
  return { ...result, report: { customersAdded, customersMatched, vehiclesAdded, skipped: skipped.slice(0, 50) } };
}

// --- new customer (and first vehicle) in the middle of something else ------------------

/**
 * Where to go once a customer has been created from inside another screen —
 * booking an appointment, starting a quote, or changing who a work order is for.
 * The value is parsed, never trusted: it picks one of three known destinations
 * and never becomes a URL on its own.
 */
type Then =
  | { kind: "quote" }
  | { kind: "order"; id: string }
  | { kind: "sale"; id: string }
  | { kind: "appointment"; query: string };

function parseThen(v: unknown): Then | null {
  const s = String(v ?? "");
  if (s === "quote") return { kind: "quote" };
  const order = /^order:([0-9a-f-]{36})$/i.exec(s);
  if (order) return { kind: "order", id: order[1] };
  const sale = /^sale:([0-9a-f-]{36})$/i.exec(s);
  if (sale) return { kind: "sale", id: sale[1] };
  if (s.startsWith("appointment:")) {
    // Only the booking form's own simple fields survive: nothing that could add a path or a host.
    const params = new URLSearchParams(s.slice("appointment:".length));
    const keep = new URLSearchParams();
    for (const k of ["date", "time", "bay", "tech", "minutes", "concern"]) {
      const val = params.get(k);
      if (val) keep.set(k, val.slice(0, 500));
    }
    return { kind: "appointment", query: keep.toString() };
  }
  return null;
}

export async function createCustomerWithVehicle(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = Object.fromEntries(form);
  const then = parseThen(raw.then);
  if (!then) return { error: "Something went wrong with that form. Reload the page and try again." };

  const c = customerSchema.safeParse({
    display_name: raw.display_name, phone: raw.phone, email: raw.email,
    address_line1: raw.address_line1, city: raw.city, region: raw.region,
    postal_code: raw.postal_code, notes: "", tax_rate_id: "",
  });
  if (!c.success) return firstError(c);

  const wantsVehicle = ["v_year", "v_make", "v_model", "v_trim", "v_vin", "v_plate", "v_mileage"]
    .some((k) => String(raw[k] ?? "").trim() !== "");

  // Validate the vehicle against the same rules as everywhere else. The customer
  // id is a stand-in: the real one does not exist until the insert below.
  const v = vehicleSchema.safeParse({
    customer_id: "00000000-0000-0000-0000-000000000000",
    year: raw.v_year ?? "", make: raw.v_make ?? "", model: raw.v_model ?? "", trim: raw.v_trim ?? "",
    vin: raw.v_vin ?? "", plate: raw.v_plate ?? "", current_mileage: raw.v_mileage ?? "",
  });
  if (wantsVehicle && !v.success) return firstError(v);
  if (wantsVehicle && v.success && !v.data.make && !v.data.model && !v.data.vin) {
    return { error: "Enter at least a make, model or VIN for the vehicle." };
  }
  if (!wantsVehicle && then.kind !== "appointment" && then.kind !== "sale") {
    return { error: "Add the customer's vehicle too — a work order is for a specific vehicle." };
  }

  return runAction("customers.edit", async (session) => {
    if (then.kind === "sale") {
      if (!can(session.role, "counterSales.create")) {
        throw Object.assign(new Error("You don't have permission to change counter sales."), { code: "P0001" });
      }
    } else if (then.kind !== "appointment" && !can(session.role, "workorders.create")) {
      throw Object.assign(new Error("You don't have permission to start work orders."), { code: "P0001" });
    }

    const d = c.data;
    const { customerId, vehicleId, orderId } = await inShop(session, async (tx) => {
      const [cust] = await tx<{ id: string }[]>`
        INSERT INTO grip.customers
          (tenant_id, display_name, phone, email, address_line1, city, region, postal_code)
        VALUES (${session.tenantId}, ${d.display_name}, ${d.phone}, ${d.email},
                ${d.address_line1}, ${d.city}, ${d.region}, ${d.postal_code})
        RETURNING id`;

      let vehicleId: string | null = null;
      if (wantsVehicle && v.success) {
        const [veh] = await tx<{ id: string }[]>`
          INSERT INTO grip.vehicles
            (tenant_id, customer_id, year, make, model, trim, vin, plate, current_mileage)
          VALUES (${session.tenantId}, ${cust.id}, ${v.data.year}, ${v.data.make}, ${v.data.model},
                  ${v.data.trim}, ${v.data.vin}, ${v.data.plate}, ${v.data.current_mileage})
          RETURNING id`;
        vehicleId = veh.id;
      }

      let orderId: string | null = null;
      if (then.kind === "quote" && vehicleId) {
        const [wo] = await tx<{ id: string }[]>`
          SELECT grip.create_work_order(${cust.id}, ${vehicleId}, NULL, NULL) AS id`;
        orderId = wo.id;
      }
      if (then.kind === "order" && vehicleId) {
        await tx`SELECT grip.set_work_order_customer(${then.id}, ${cust.id}, ${vehicleId})`;
      }
      if (then.kind === "sale") {
        await tx`SELECT grip.set_counter_sale_customer(${then.id}, ${cust.id}, NULL)`;
      }
      return { customerId: cust.id, vehicleId, orderId };
    });

    revalidatePath("/app", "layout");

    if (then.kind === "appointment") {
      const q = new URLSearchParams(then.query);
      q.set("customer", customerId);
      if (vehicleId) q.set("vehicle", vehicleId);
      redirect(`/app/schedule/new?${q.toString()}`);
    }
    if (then.kind === "order") redirect(`/app/orders/${then.id}`);
    if (then.kind === "sale") redirect(`/app/parts/sales/${then.id}`);
    if (orderId) redirect(`/app/orders/${orderId}`);
  }).then((r) =>
    r.error === "That already exists." ? { error: "A vehicle with that VIN is already on file." } : r,
  );
}

/**
 * Adds a vehicle to an existing customer from inside another screen and carries
 * on: straight into a new quote, back to the booking form with the new vehicle
 * ticked, or onto the work order it was added for.
 */
export async function addVehicleInline(_prev: ActionState, form: FormData): Promise<ActionState> {
  const raw = Object.fromEntries(form);
  const then = parseThen(raw.then);
  if (!then) return { error: "Something went wrong with that form. Reload the page and try again." };

  const v = vehicleSchema.safeParse({
    customer_id: raw.customer_id, year: raw.year ?? "", make: raw.make ?? "", model: raw.model ?? "",
    trim: raw.trim ?? "", vin: raw.vin ?? "", plate: raw.plate ?? "", current_mileage: raw.current_mileage ?? "",
  });
  if (!v.success) return firstError(v);
  if (!v.data.make && !v.data.model && !v.data.vin) {
    return { error: "Enter at least a make, model or VIN." };
  }
  const d = v.data;

  return runAction("customers.edit", async (session) => {
    if (then.kind !== "appointment" && !can(session.role, "workorders.create")) {
      throw Object.assign(new Error("You don't have permission to start work orders."), { code: "P0001" });
    }

    const { vehicleId, orderId } = await inShop(session, async (tx) => {
      // Only attach to a customer this shop actually has; RLS hides other shops'.
      const [owner] = await tx`SELECT 1 FROM grip.customers WHERE id = ${d.customer_id}`;
      if (!owner) throw Object.assign(new Error("Customer not found."), { code: "P0001" });

      const [veh] = await tx<{ id: string }[]>`
        INSERT INTO grip.vehicles
          (tenant_id, customer_id, year, make, model, trim, vin, plate, current_mileage)
        VALUES (${session.tenantId}, ${d.customer_id}, ${d.year}, ${d.make}, ${d.model}, ${d.trim},
                ${d.vin}, ${d.plate}, ${d.current_mileage})
        RETURNING id`;

      let orderId: string | null = null;
      if (then.kind === "quote") {
        const [wo] = await tx<{ id: string }[]>`
          SELECT grip.create_work_order(${d.customer_id}, ${veh.id}, NULL, NULL) AS id`;
        orderId = wo.id;
      }
      if (then.kind === "order") {
        await tx`SELECT grip.set_work_order_customer(${then.id}, ${d.customer_id}, ${veh.id})`;
      }
      return { vehicleId: veh.id, orderId };
    });

    revalidatePath("/app", "layout");

    if (then.kind === "appointment") {
      const q = new URLSearchParams(then.query);
      q.set("customer", d.customer_id);
      q.set("vehicle", vehicleId);
      redirect(`/app/schedule/new?${q.toString()}`);
    }
    if (then.kind === "order") redirect(`/app/orders/${then.id}`);
    redirect(`/app/orders/${orderId}`);
  }).then((r) =>
    r.error === "That already exists." ? { error: "A vehicle with that VIN is already on file." } : r,
  );
}
