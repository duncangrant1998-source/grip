/**
 * Seeds two demo shops with one user per role, plus a platform-admin tenant
 * for the SaaS operator.
 *
 * Deliberately creates *two* shops with overlapping-looking data (both have a
 * part with SKU BP-1234, both have a customer called "Dave") so that a tenant
 * isolation bug shows up as obviously wrong data rather than an empty screen.
 *
 * Runs on the owner connection. Where it calls a grip.* function it sets
 * app.tenant_id first, because those functions are tenant-scoped by design.
 */
import postgres from "postgres";
import { hash } from "@node-rs/argon2";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const DEMO_PASSWORD = "demo1234";

type Sql = postgres.Sql;

async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    console.log("Clearing existing demo data ...");
    // Order does not matter: every tenant-owned table cascades from tenants.
    await sql`DELETE FROM grip.tenants`;

    const passwordHash = await hash(DEMO_PASSWORD);

    const redline = await seedShop(sql, passwordHash, {
      name: "Redline Performance",
      slug: "redline",
      labourRate: "145.00",
      billingMode: "flat_rate",
      city: "Toronto",
      areaCode: "416",
      hstNumber: "801234567RT0001",
      emailDomain: "redline.test",
      timezone: "America/Toronto",
    });

    const northside = await seedShop(sql, passwordHash, {
      name: "Northside Auto Service",
      slug: "northside",
      labourRate: "110.00",
      billingMode: "straight_time",
      city: "Ottawa",
      areaCode: "613",
      hstNumber: "802345678RT0001",
      emailDomain: "northside.test",
      timezone: "America/Toronto",
    });

    // The SaaS operator lives in a tenant of their own.
    const [platformTenant] = await sql<{ id: string }[]>`
      INSERT INTO grip.tenants (name, slug, plan, status)
      VALUES ('Grip Platform', 'grip-platform', 'internal', 'active')
      RETURNING id`;
    const [operator] = await sql<{ id: string }[]>`
      INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
      VALUES (${platformTenant.id}, 'operator@grip.test', ${passwordHash},
              'Platform Operator', 'shop_admin')
      RETURNING id`;
    await sql`
      INSERT INTO grip.platform_admins (user_id, note)
      VALUES (${operator.id}, 'seeded demo super-admin')`;

    console.log("\nSeeded.\n");
    console.log(`  Shop 1: Redline Performance      (${redline.tenantId})`);
    console.log(`  Shop 2: Northside Auto Service   (${northside.tenantId})`);
    console.log(`\n  All demo passwords: ${DEMO_PASSWORD}\n`);
    for (const shop of [redline, northside]) {
      console.log(`  ${shop.name}`);
      for (const [role, email] of Object.entries(shop.logins)) {
        console.log(`    ${role.padEnd(16)} ${email}`);
      }
    }
    console.log(`\n  Platform super-admin`);
    console.log(`    platform_admin   operator@grip.test\n`);
  } finally {
    await sql.end();
  }
}

type ShopSpec = {
  name: string;
  slug: string;
  labourRate: string;
  billingMode: "flat_rate" | "straight_time";
  city: string;
  areaCode: string;
  hstNumber: string;
  emailDomain: string;
  timezone: string;
};

async function seedShop(sql: Sql, passwordHash: string, spec: ShopSpec) {
  console.log(`Seeding ${spec.name} ...`);

  const [tenant] = await sql<{ id: string }[]>`
    INSERT INTO grip.tenants (name, slug, plan, status, trial_ends_at, city, province)
    VALUES (${spec.name}, ${spec.slug}, 'shop', 'active', now() + interval '14 days',
            ${spec.city}, 'ON')
    RETURNING id`;
  const tenantId = tenant.id;

  // --- tax -----------------------------------------------------------------
  // Ontario: HST at 13% as the default, plus the exempt option every shop gets
  // for status-card holders, fleet and warranty work.
  const [taxRate] = await sql<{ id: string }[]>`
    SELECT grip.create_ontario_tax_rates(${tenantId}, 1300) AS id`;
  const [exempt] = await sql<{ id: string }[]>`
    SELECT id FROM grip.tax_rates WHERE tenant_id = ${tenantId} AND name = 'Exempt'`;

  await sql`
    INSERT INTO grip.tenant_settings
      (tenant_id, legal_name, city, region, country, default_labour_rate,
       labour_billing_mode, default_tax_rate_id, timezone, hst_number, invoice_footer)
    VALUES
      (${tenantId}, ${spec.name}, ${spec.city}, 'ON', 'CA', ${spec.labourRate},
       ${spec.billingMode}, ${taxRate.id}, ${spec.timezone}, ${spec.hstNumber},
       'Thank you for your business. All work guaranteed 12 months / 20,000 km.')`;

  // --- people --------------------------------------------------------------
  const roles = [
    { role: "service_advisor", name: "Sam Reyes", local: "service" },
    { role: "parts_advisor", name: "Jordan Kerr", local: "parts" },
    { role: "technician", name: "Alex Novak", local: "tech" },
    { role: "shop_admin", name: "Casey Lund", local: "admin" },
  ] as const;

  const logins: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  for (const r of roles) {
    const email = `${r.local}@${spec.emailDomain}`;
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO grip.users (tenant_id, email, password_hash, full_name, role)
      VALUES (${tenantId}, ${email}, ${passwordHash}, ${r.name}, ${r.role})
      RETURNING id`;
    logins[r.role] = email;
    userIds[r.role] = u.id;
  }

  const [tech] = await sql<{ id: string }[]>`
    INSERT INTO grip.employees
      (tenant_id, user_id, full_name, job_title, hourly_rate, billable_rate, is_technician)
    VALUES
      (${tenantId}, ${userIds.technician}, 'Alex Novak', 'Journeyman Technician',
       42.00, ${spec.labourRate}, true)
    RETURNING id`;
  const [pat] = await sql<{ id: string }[]>`
    INSERT INTO grip.employees (tenant_id, full_name, job_title, hourly_rate, billable_rate, is_technician)
    VALUES (${tenantId}, 'Pat Oyelaran', 'Apprentice Technician', 24.00, ${spec.labourRate}, true)
    RETURNING id`;

  // Everyone with a login is also a staff member, so everyone can use the time clock.
  for (const [role, title, rate] of [
    ["service_advisor", "Service Advisor", 31],
    ["parts_advisor", "Parts Advisor", 28],
    ["shop_admin", "Shop Manager", 48],
  ] as const) {
    const [u] = await sql<{ full_name: string }[]>`
      SELECT full_name FROM grip.users WHERE id = ${userIds[role]}`;
    await sql`
      INSERT INTO grip.employees (tenant_id, user_id, full_name, job_title, hourly_rate)
      VALUES (${tenantId}, ${userIds[role]}, ${u.full_name}, ${title}, ${rate})`;
  }

  // Two time-off requests from the technician: one still waiting on the manager,
  // one already approved, so both the inbox and the calendar have something in them.
  await sql`
    INSERT INTO grip.time_off_requests
      (tenant_id, employee_id, recipient_user_id, from_date, to_date, note, status, decided_by, decided_at, decision_note)
    VALUES
      (${tenantId}, ${tech.id}, ${userIds.shop_admin}, current_date + 21, current_date + 23,
       'Family wedding out of town', 'pending', NULL, NULL, NULL),
      (${tenantId}, ${tech.id}, ${userIds.shop_admin}, current_date + 35, current_date + 36,
       'Dentist and a long weekend', 'approved', ${userIds.shop_admin}, now(), 'Enjoy it.')`;

  // Six weeks of shifts from this Monday, at the shop's wall clock: most people work
  // Monday to Friday 8-4, and the apprentice works Tuesday to Saturday 10-6, so the
  // calendars have a pattern worth looking at rather than one repeated row.
  await sql`
    INSERT INTO grip.shifts (tenant_id, employee_id, starts_at, ends_at)
    SELECT ${tenantId}, e.id,
           (date_trunc('week', now() AT TIME ZONE ${spec.timezone}) + (w.n * 7 + g.d) * interval '1 day'
              + CASE WHEN e.full_name = 'Pat Oyelaran' THEN interval '10 hours' ELSE interval '8 hours' END)
             AT TIME ZONE ${spec.timezone},
           (date_trunc('week', now() AT TIME ZONE ${spec.timezone}) + (w.n * 7 + g.d) * interval '1 day'
              + CASE WHEN e.full_name = 'Pat Oyelaran' THEN interval '18 hours' ELSE interval '16 hours' END)
             AT TIME ZONE ${spec.timezone}
    FROM grip.employees e
    CROSS JOIN generate_series(0, 5) AS w(n)
    CROSS JOIN generate_series(0, 5) AS g(d)
    WHERE e.tenant_id = ${tenantId} AND (e.user_id IS NOT NULL OR e.is_technician)
      AND (CASE WHEN e.full_name = 'Pat Oyelaran' THEN g.d BETWEEN 1 AND 5 ELSE g.d BETWEEN 0 AND 4 END)`;

  await sql`
    INSERT INTO grip.time_entries (tenant_id, employee_id, clock_in, clock_out)
    SELECT ${tenantId}, e.id,
           (g.d + interval '8 hours')  AT TIME ZONE ${spec.timezone},
           (g.d + interval '16 hours') AT TIME ZONE ${spec.timezone}
    FROM grip.employees e
    CROSS JOIN generate_series(
      date_trunc('day', now() AT TIME ZONE ${spec.timezone}) - interval '42 days',
      date_trunc('day', now() AT TIME ZONE ${spec.timezone}) - interval '1 day',
      interval '1 day') AS g(d)
    WHERE e.tenant_id = ${tenantId} AND (e.user_id IS NOT NULL OR e.is_technician)
      AND extract(isodow FROM g.d) < 6`;

  for (const [i, name] of ["Bay 1", "Bay 2", "Alignment Rack"].entries()) {
    await sql`
      INSERT INTO grip.bays (tenant_id, name, sort_order)
      VALUES (${tenantId}, ${name}, ${i})`;
  }
  const bayRows = await sql<{ id: string }[]>`
    SELECT id FROM grip.bays WHERE tenant_id = ${tenantId} ORDER BY sort_order`;
  const [bay] = bayRows;

  // --- parts ---------------------------------------------------------------
  const [supplier] = await sql<{ id: string }[]>`
    INSERT INTO grip.suppliers
      (tenant_id, name, account_no, phone, lead_time_days, address_line1, city, region, postal_code,
       hours, delivery_notes)
    VALUES (${tenantId}, 'Great Lakes Auto Parts', ${"ACC-" + spec.slug.toUpperCase()},
            ${spec.areaCode + "-555-0177"}, 1, '300 Industrial Pkwy', ${spec.city}, 'ON', 'L4K 3C3',
            'Mon-Fri 7:30-5:00, Sat 8:00-12:00, closed Sunday',
            'Same day if ordered before 10 a.m. Two truck runs a day, 11:00 and 3:30. Free delivery over $150.')
    RETURNING id`;

  // Same SKUs in both shops on purpose — an isolation bug then shows as the
  // wrong shop's stock levels, not as an empty list.
  const catalogue = [
    { sku: "BP-1234", desc: "Ceramic brake pads, front", cat: "Brakes", sub: "Pads", bin: "A-01", cost: "48.20", price: "119.95", onHand: 60, reorder: 4 },
    { sku: "RT-5567", desc: "Brake rotor, front, vented", cat: "Brakes", sub: "Rotors", bin: "A-02", cost: "61.00", price: "148.00", onHand: 6, reorder: 4 },
    { sku: "OF-0090", desc: "Oil filter, spin-on", cat: "Engine", sub: "Filters", bin: "B-11", cost: "6.40", price: "17.95", onHand: 400, reorder: 20 },
    { sku: "OIL-5W30", desc: "5W-30 full synthetic, 1 L", cat: "Fluids", sub: "Oil", bin: "B-01", cost: "7.10", price: "16.50", onHand: 1500, reorder: 48 },
    { sku: "SP-IR6", desc: "Iridium spark plug", cat: "Ignition", sub: "Spark plugs", bin: "C-04", cost: "12.75", price: "31.00", onHand: 400, reorder: 8 },
    { sku: "ALT-7781", desc: "Alternator, 180A, remanufactured", cat: "Electrical", sub: "Charging", bin: "D-02", cost: "214.00", price: "489.00", onHand: 1, reorder: 1 },
    { sku: "TB-2200", desc: "Timing belt kit", cat: "Engine", sub: "Timing", bin: "D-07", cost: "188.50", price: "412.00", onHand: 2, reorder: 1 },
  ];

  const partIds: Record<string, string> = {};
  for (const p of catalogue) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO grip.parts
        (tenant_id, sku, description, category, subcategory, bin_location, unit_cost, unit_price,
         reorder_point, reorder_qty, supplier_id)
      VALUES
        (${tenantId}, ${p.sku}, ${p.desc}, ${p.cat}, ${p.sub}, ${p.bin}, ${p.cost}, ${p.price},
         ${p.reorder}, ${p.reorder * 2}, ${supplier.id})
      RETURNING id`;
    partIds[p.sku] = row.id;
    await sql`
      INSERT INTO grip.part_stock (part_id, tenant_id, qty_on_hand)
      VALUES (${row.id}, ${tenantId}, ${p.onHand})`;
    await sql`
      INSERT INTO grip.stock_movements (tenant_id, part_id, kind, delta, ref_type, note)
      VALUES (${tenantId}, ${row.id}, 'receive', ${p.onHand}, 'seed', 'opening stock')`;
  }

  // --- service shortcuts ---------------------------------------------------
  // LOF has labour and parts, FBP the same, DIAG labour only, OILF parts only.
  const shortcuts: {
    code: string; name: string;
    labour: [string, number][]; parts: [string, number][];
  }[] = [
    { code: "LOF", name: "Lube, oil and filter change", labour: [["Lube, oil and filter service", 0.8]], parts: [["OF-0090", 1], ["OIL-5W30", 5]] },
    { code: "FBP", name: "Front brake pads", labour: [["Replace front brake pads", 1.5]], parts: [["BP-1234", 1]] },
    { code: "DIAG", name: "Diagnostic", labour: [["Diagnostic time", 1]], parts: [] },
    { code: "OILF", name: "Oil and filter (parts only)", labour: [], parts: [["OF-0090", 1], ["OIL-5W30", 5]] },
  ];
  for (const s of shortcuts) {
    const [sc] = await sql<{ id: string }[]>`
      INSERT INTO grip.service_shortcuts (tenant_id, code, name)
      VALUES (${tenantId}, ${s.code}, ${s.name}) RETURNING id`;
    let order = 0;
    for (const [description, hours] of s.labour) {
      await sql`
        INSERT INTO grip.service_shortcut_labour (tenant_id, shortcut_id, description, hours, sort_order)
        VALUES (${tenantId}, ${sc.id}, ${description}, ${hours}, ${order++})`;
    }
    for (const [sku, qty] of s.parts) {
      await sql`
        INSERT INTO grip.service_shortcut_parts (tenant_id, shortcut_id, part_id, qty, sort_order)
        VALUES (${tenantId}, ${sc.id}, ${partIds[sku]}, ${qty}, ${order++})`;
    }
  }

  // --- customers and vehicles ---------------------------------------------
  const customers = [
    { name: "Dave Mercer", email: "dave.mercer@example.com", address: "214 Dundas St W", postal: "M5T 1H1", phone: `${spec.areaCode}-555-0142`, vehicle: { year: 2017, make: "Subaru", model: "WRX", vin: `JF1VA1${spec.slug.toUpperCase().slice(0, 2)}5H9812345`, plate: "KB 442", km: 128400 } },
    { name: "Priya Raman", email: "priya.raman@example.com", address: "67 Baldwin St", postal: "M5T 1L2", phone: `${spec.areaCode}-555-0188`, vehicle: { year: 2020, make: "Ford", model: "F-150", vin: `1FTEW1${spec.slug.toUpperCase().slice(0, 2)}0LKE12345`, plate: "NT 889", km: 74210 } },
    { name: "Mountain Ridge Landscaping", exempt: true, email: "accounts@mountainridge.example.com", address: "1450 Industrial Rd", postal: "M9W 5C4", phone: `${spec.areaCode}-555-0110`, vehicle: { year: 2015, make: "Ram", model: "2500", vin: `3C6UR5${spec.slug.toUpperCase().slice(0, 2)}1FG512345`, plate: "FL 017", km: 241900 } },
  ];

  const vehicleIds: string[] = [];
  const customerIds: string[] = [];
  for (const c of customers) {
    const [cust] = await sql<{ id: string }[]>`
      INSERT INTO grip.customers
        (tenant_id, display_name, phone, email, address_line1, postal_code, city, region, tax_rate_id,
         exempt_reason, exempt_reference, exempt_expires_on)
      VALUES (${tenantId}, ${c.name}, ${c.phone}, ${c.email}, ${c.address}, ${c.postal},
              ${spec.city}, 'ON',
              ${"exempt" in c && c.exempt ? exempt.id : null},
              ${"exempt" in c && c.exempt ? "resale" : null}::grip.exempt_reason,
              ${"exempt" in c && c.exempt ? "734512890RT0001" : null},
              ${"exempt" in c && c.exempt ? "2027-12-31" : null}::date)
      RETURNING id`;
    customerIds.push(cust.id);
    const [veh] = await sql<{ id: string }[]>`
      INSERT INTO grip.vehicles
        (tenant_id, customer_id, vin, year, make, model, plate, current_mileage)
      VALUES
        (${tenantId}, ${cust.id}, ${c.vehicle.vin}, ${c.vehicle.year}, ${c.vehicle.make},
         ${c.vehicle.model}, ${c.vehicle.plate}, ${c.vehicle.km})
      RETURNING id`;
    vehicleIds.push(veh.id);
  }

  // --- appointments --------------------------------------------------------
  // A working week around today, in the SHOP's timezone. The wall-clock time is
  // built in SQL ((local midnight + offset) AT TIME ZONE tz) so it is exact
  // whatever timezone this machine is in.
  const appt = (
    day: number, startMin: number, minutes: number, bayIdx: number | null,
    techId: string | null, who: number, status: string, concern: string,
  ) => sql`
    INSERT INTO grip.appointments
      (tenant_id, customer_id, vehicle_id, bay_id, assigned_tech_id, starts_at,
       estimated_minutes, status, concern, created_by)
    VALUES
      (${tenantId}, ${customerIds[who]}, ${vehicleIds[who]},
       ${bayIdx === null ? null : bayRows[bayIdx].id}, ${techId},
       (date_trunc('day', now() AT TIME ZONE ${spec.timezone})
         + ${day}::int * interval '1 day' + ${startMin}::int * interval '1 minute')
         AT TIME ZONE ${spec.timezone},
       ${minutes}, ${status}::grip.appointment_status, ${concern}, ${userIds.service_advisor})`;

  await appt(0, 8 * 60,       90, 0, tech.id, 0, "in_progress", "Front brake grinding — pads and rotors");
  await appt(0, 8 * 60 + 30,  60, 1, pat.id,  1, "arrived",     "Oil service and tire rotation");
  await appt(0, 10 * 60,      60, 1, pat.id,  2, "confirmed",   "Fleet truck: pre-trip inspection");
  await appt(0, 13 * 60,     120, 0, tech.id, 1, "scheduled",   "Check engine light, rough idle");
  await appt(0, 15 * 60,      45, null, null, 0, "scheduled",   "Estimate for lowering springs");
  await appt(1, 9 * 60,       90, 0, tech.id, 1, "scheduled",   "Timing belt kit");
  await appt(1, 9 * 60,      180, 2, pat.id,  2, "confirmed",   "Alignment and suspension check");
  await appt(1, 14 * 60,      60, 1, tech.id, 0, "scheduled",   "Brake fluid flush");
  await appt(2, 8 * 60,      240, 0, tech.id, 2, "scheduled",   "Fleet: oil change x2 and tire rotation");
  await appt(3, 10 * 60,      60, 1, pat.id,  0, "scheduled",   "Coolant leak diagnosis");
  await appt(4, 9 * 60 + 30, 120, 0, tech.id, 1, "scheduled",   "Spring service package");

  // --- a live work order ---------------------------------------------------
  // Written the way the app will write it: tenant-scoped, and through the
  // reservation function so stock actually moves.
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`SELECT set_config('app.user_id', ${userIds.service_advisor}, true)`;
    await tx`SELECT set_config('app.is_platform_admin', 'false', true)`;

    const [{ next_document_number: number }] = await tx<{ next_document_number: number }[]>`
      SELECT grip.next_document_number('work_order')`;

    const [wo] = await tx<{ id: string }[]>`
      INSERT INTO grip.work_orders
        (tenant_id, number, customer_id, vehicle_id, status, concern, mileage_in,
         service_advisor_id, opened_by, tax_rate_id, labour_billing_mode)
      VALUES
        (${tenantId}, ${number}, ${customerIds[0]}, ${vehicleIds[0]}, 'in_progress',
         'Grinding from front brakes under light braking', 128400,
         ${userIds.service_advisor}, ${userIds.service_advisor}, ${taxRate.id},
         ${spec.billingMode})
      RETURNING id`;

    // Service advisor adds labour.
    await tx`
      INSERT INTO grip.work_order_labour_lines
        (tenant_id, work_order_id, description, billed_hours, actual_hours, rate,
         billing_mode, tech_id, added_by_user_id)
      VALUES
        (${tenantId}, ${wo.id}, 'Replace front brake pads and rotors',
         2.40, 2.10, ${spec.labourRate}, ${spec.billingMode}, ${tech.id},
         ${userIds.service_advisor})`;

    // Parts advisor adds parts to the SAME live order — the whole point of the
    // product, and the reason added_by_user_id is on every line.
    await tx`SELECT set_config('app.user_id', ${userIds.parts_advisor}, true)`;
    await tx`SELECT grip.add_part_to_work_order(${wo.id}, ${partIds["BP-1234"]}, 1, ${userIds.parts_advisor})`;
    await tx`SELECT grip.add_part_to_work_order(${wo.id}, ${partIds["RT-5567"]}, 2, ${userIds.parts_advisor})`;

    await tx`SELECT grip.recalculate_work_order(${wo.id})`;
  });

  // --- a completed, invoiced job so reports have something to chew on ------
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`SELECT set_config('app.user_id', ${userIds.service_advisor}, true)`;
    await tx`SELECT set_config('app.is_platform_admin', 'false', true)`;

    const [{ next_document_number: number }] = await tx<{ next_document_number: number }[]>`
      SELECT grip.next_document_number('work_order')`;

    const [wo] = await tx<{ id: string }[]>`
      INSERT INTO grip.work_orders
        (tenant_id, number, customer_id, vehicle_id, status, concern, mileage_in,
         service_advisor_id, opened_by, tax_rate_id, labour_billing_mode)
      VALUES
        (${tenantId}, ${number}, ${customerIds[1]}, ${vehicleIds[1]}, 'in_progress',
         'Scheduled maintenance', 74210, ${userIds.service_advisor},
         ${userIds.service_advisor}, ${taxRate.id}, ${spec.billingMode})
      RETURNING id`;

    await tx`
      INSERT INTO grip.work_order_labour_lines
        (tenant_id, work_order_id, description, billed_hours, actual_hours, rate,
         billing_mode, tech_id, added_by_user_id)
      VALUES
        (${tenantId}, ${wo.id}, 'Lube, oil and filter; rotate tires',
         0.80, 0.60, ${spec.labourRate}, ${spec.billingMode}, ${tech.id},
         ${userIds.service_advisor})`;

    await tx`SELECT grip.add_part_to_work_order(${wo.id}, ${partIds["OF-0090"]}, 1, ${userIds.parts_advisor})`;
    await tx`SELECT grip.add_part_to_work_order(${wo.id}, ${partIds["OIL-5W30"]}, 6, ${userIds.parts_advisor})`;
    await tx`SELECT grip.complete_work_order(${wo.id}, ${userIds.technician})`;
    await tx`SELECT grip.invoice_work_order(${wo.id})`;
  });

  // --- a counter sale ------------------------------------------------------
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`SELECT set_config('app.user_id', ${userIds.parts_advisor}, true)`;
    await tx`SELECT set_config('app.is_platform_admin', 'false', true)`;

    const [{ next_document_number: number }] = await tx<{ next_document_number: number }[]>`
      SELECT grip.next_document_number('counter_sale')`;

    const [sale] = await tx<{ id: string }[]>`
      INSERT INTO grip.counter_sales
        (tenant_id, number, customer_name, status, tax_rate_id, sold_by)
      VALUES
        (${tenantId}, ${number}, 'Walk-in — cash', 'open', ${taxRate.id},
         ${userIds.parts_advisor})
      RETURNING id`;

    await tx`SELECT grip.add_part_to_counter_sale(${sale.id}, ${partIds["SP-IR6"]}, 4, ${userIds.parts_advisor})`;
    await tx`SELECT grip.complete_counter_sale(${sale.id})`;
  });

  // --- six weeks of history, so the reports have something to say -----------
  // Built through the same functions the app uses, then moved back in time. The
  // two techs differ on purpose: Alex usually beats book time, Pat is slower.
  type Job = { ago: number; who: 0 | 1 | 2; tech: "alex" | "pat"; billed: number; actual: number;
               what: string; parts: [string, number][]; paid: boolean };

  // A busy-but-realistic two-tech shop: about five jobs every weekday for six weeks.
  // Deterministic, so every seed run produces the same shop. Alex usually beats book
  // time (actual < billed) and Pat is a little slower, so efficiency differs by person.
  let rngState = spec.slug === "redline" ? 7 : 13;
  const rnd = () => (rngState = (rngState * 1664525 + 1013904223) % 4294967296) / 4294967296;

  const kinds: { what: string; billed: number; parts: [string, number][]; weight: number }[] = [
    { what: "Oil and filter service",  billed: 1.0, parts: [["OF-0090", 1], ["OIL-5W30", 5]], weight: 26 },
    { what: "Front brake pads",        billed: 2.5, parts: [["BP-1234", 1]],                  weight: 12 },
    { what: "Diagnostic",              billed: 2.0, parts: [],                                 weight: 14 },
    { what: "Spark plug replacement",  billed: 2.0, parts: [["SP-IR6", 4]],                   weight: 10 },
    { what: "Alignment",               billed: 1.5, parts: [],                                 weight: 10 },
    { what: "Brake inspection",        billed: 1.0, parts: [],                                 weight: 12 },
    { what: "Suspension repair",       billed: 3.5, parts: [],                                 weight: 8 },
    { what: "Performance tune",        billed: 4.0, parts: [["OF-0090", 1], ["OIL-5W30", 6]], weight: 8 },
  ];
  const totalWeight = kinds.reduce((a, k) => a + k.weight, 0);
  const pickKind = () => {
    let r = rnd() * totalWeight;
    for (const k of kinds) if ((r -= k.weight) < 0) return k;
    return kinds[0];
  };

  const weekdays = await sql<{ ago: number; dow: number }[]>`
    SELECT a AS ago,
           extract(isodow FROM date_trunc('day', now() AT TIME ZONE ${spec.timezone}) - a * interval '1 day')::int AS dow
    FROM generate_series(1, 41) AS a`;

  const history: Job[] = [];
  for (const { ago, dow } of weekdays) {
    if (dow > 5) continue; // closed weekends
    for (let n = 0; n < 5; n++) {
      const k = pickKind();
      const isAlex = rnd() < 0.55;
      const billed = Math.round(k.billed * (0.8 + rnd() * 0.5) * 10) / 10;
      const factor = isAlex ? 0.78 + rnd() * 0.17 : 1.0 + rnd() * 0.3;
      history.push({
        ago, who: (n % 3) as 0 | 1 | 2, tech: isAlex ? "alex" : "pat", billed,
        actual: Math.round(billed * factor * 100) / 100, what: k.what, parts: k.parts,
        paid: ago > 6,
      });
    }
  }

  // Noon at the shop, `ago` days back.
  const noon = (ago: number) => sql`
    ((date_trunc('day', now() AT TIME ZONE ${spec.timezone}) - ${ago}::int * interval '1 day'
      + interval '12 hours') AT TIME ZONE ${spec.timezone})`;

  for (const j of history) {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx`SELECT set_config('app.user_id', ${userIds.service_advisor}, true)`;
      await tx`SELECT set_config('app.is_platform_admin', 'false', true)`;

      const [{ create_work_order: id }] = await tx<{ create_work_order: string }[]>`
        SELECT grip.create_work_order(${customerIds[j.who]}, ${vehicleIds[j.who]}, ${j.what}, ${null}::int)`;
      await tx`
        SELECT grip.add_labour_line(${id}, ${j.what}, ${j.billed}, ${j.actual}, ${null}::numeric,
          ${null}::grip.labour_billing_mode, ${j.tech === "alex" ? tech.id : pat.id}, true)`;
      for (const [sku, qty] of j.parts) {
        await tx`SELECT grip.add_part_to_work_order(${id}, ${partIds[sku]}, ${qty}, ${userIds.parts_advisor})`;
      }
      for (const to of ["approved", "in_progress", "completed", "invoiced", ...(j.paid ? ["paid"] : [])]) {
        await tx`SELECT grip.transition_work_order(${id}, ${to}::grip.work_order_status)`;
      }
      await tx`
        UPDATE grip.work_orders
        SET created_at = ${noon(j.ago)}, approved_at = ${noon(j.ago)}, completed_at = ${noon(j.ago)},
            invoiced_at = ${noon(j.ago)}, paid_at = ${j.paid ? noon(j.ago) : null}
        WHERE id = ${id}`;
    });
  }

  for (const [ago, sku, qty] of [
    [40, "OIL-5W30", 4], [33, "OF-0090", 3], [26, "SP-IR6", 4], [19, "OIL-5W30", 6],
    [11, "OF-0090", 2], [6, "SP-IR6", 2], [2, "OIL-5W30", 3],
  ] as [number, string, number][]) {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      await tx`SELECT set_config('app.user_id', ${userIds.parts_advisor}, true)`;
      await tx`SELECT set_config('app.is_platform_admin', 'false', true)`;
      const [{ create_counter_sale: id }] = await tx<{ create_counter_sale: string }[]>`
        SELECT grip.create_counter_sale(${null}::uuid, ${null}::text)`;
      await tx`SELECT grip.add_part_to_counter_sale(${id}, ${partIds[sku]}, ${qty}, ${userIds.parts_advisor})`;
      await tx`SELECT grip.complete_counter_sale(${id})`;
      await tx`UPDATE grip.counter_sales SET created_at = ${noon(ago)}, completed_at = ${noon(ago)} WHERE id = ${id}`;
    });
  }

  // --- an open purchase order ---------------------------------------------
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`SELECT set_config('app.user_id', ${userIds.parts_advisor}, true)`;
    await tx`SELECT set_config('app.is_platform_admin', 'false', true)`;

    const [{ next_document_number: number }] = await tx<{ next_document_number: number }[]>`
      SELECT grip.next_document_number('purchase_order')`;

    const [po] = await tx<{ id: string }[]>`
      INSERT INTO grip.purchase_orders
        (tenant_id, number, supplier_id, status, tax_rate_id, expected_at, created_by)
      VALUES
        (${tenantId}, ${number}, ${supplier.id}, 'ordered', ${taxRate.id},
         current_date + 3, ${userIds.parts_advisor})
      RETURNING id`;

    await tx`
      INSERT INTO grip.purchase_order_lines
        (tenant_id, purchase_order_id, part_id, qty_ordered, unit_cost)
      VALUES
        (${tenantId}, ${po.id}, ${partIds["ALT-7781"]}, 2, 214.00),
        (${tenantId}, ${po.id}, ${partIds["BP-1234"]}, 8, 48.20)`;

    await tx`
      UPDATE grip.part_stock SET qty_on_order = 2 WHERE part_id = ${partIds["ALT-7781"]}`;
  });

  // --- every booking has its quote ------------------------------------------
  // Booking in the app creates the appointment and its work order together, so the
  // seeded week does too: each appointment gets a linked quote, and the live
  // order above is the one for the job already in progress. Done last so the
  // order numbers of everything above are unchanged.
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`SELECT set_config('app.user_id', ${userIds.service_advisor}, true)`;
    await tx`SELECT set_config('app.is_platform_admin', 'false', true)`;

    // The job on the bench is the first booking of the day.
    await tx`
      UPDATE grip.work_orders SET appointment_id = (
        SELECT id FROM grip.appointments
        WHERE tenant_id = ${tenantId} AND status = 'in_progress' ORDER BY starts_at LIMIT 1)
      WHERE tenant_id = ${tenantId}
        AND concern = 'Grinding from front brakes under light braking'`;

    const appts = await tx<{ id: string; customer_id: string; vehicle_id: string; concern: string | null }[]>`
      SELECT a.id, a.customer_id, a.vehicle_id, a.concern FROM grip.appointments a
      WHERE a.tenant_id = ${tenantId} AND a.status IN ('scheduled', 'confirmed', 'arrived')
        AND NOT EXISTS (SELECT 1 FROM grip.work_orders w WHERE w.appointment_id = a.id)
      ORDER BY a.starts_at`;
    for (const a of appts) {
      const [wo] = await tx<{ id: string }[]>`
        SELECT grip.create_work_order(${a.customer_id}, ${a.vehicle_id}, ${a.concern}, NULL) AS id`;
      await tx`UPDATE grip.work_orders SET appointment_id = ${a.id} WHERE id = ${wo.id}`;
    }
  });

  // Time on jobs for the technicians over the last two weeks: two stretches a day on
  // finished work orders, inside the shift already on the clock.
  await sql`
    INSERT INTO grip.job_time_entries (tenant_id, employee_id, work_order_id, clock_in, clock_out)
    SELECT ${tenantId}, e.id, w.id,
           (g.d + p.start_h) AT TIME ZONE ${spec.timezone},
           (g.d + p.end_h)   AT TIME ZONE ${spec.timezone}
    FROM grip.employees e
    CROSS JOIN generate_series(
      date_trunc('day', now() AT TIME ZONE ${spec.timezone}) - interval '14 days',
      date_trunc('day', now() AT TIME ZONE ${spec.timezone}) - interval '1 day',
      interval '1 day') AS g(d)
    CROSS JOIN (VALUES (1, interval '8 hours 30 minutes', interval '12 hours'),
                       (2, interval '13 hours', interval '15 hours 30 minutes')) AS p(n, start_h, end_h)
    CROSS JOIN LATERAL (
      SELECT x.id FROM grip.work_orders x
      WHERE x.tenant_id = ${tenantId} AND x.completed_at IS NOT NULL
      ORDER BY md5(x.id::text || e.id::text || g.d::text || p.n::text) LIMIT 1) AS w
    WHERE e.tenant_id = ${tenantId} AND e.is_technician AND extract(isodow FROM g.d) < 6`;

  void exempt;
  return { tenantId, name: spec.name, logins };
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
