import { requireSession, inShop } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * The shop's customers and vehicles as a spreadsheet — one row per vehicle,
 * with the customer repeated, and a single row for a customer who has none.
 * The columns are exactly what the importer reads, so a file exported from one
 * shop can be loaded into another.
 */
export async function GET() {
  const session = await requireSession();
  if (!can(session.role, "customers.view", session.extraRoles)) {
    return new Response("Not allowed", { status: 403 });
  }

  const rows = await inShop(session, (tx) => tx<Record<string, string | null>[]>`
    SELECT c.display_name AS name, c.email, c.phone,
           c.address_line1 AS address, c.city, c.region AS province,
           c.postal_code, c.notes,
           v.year::text AS vehicle_year, v.make AS vehicle_make, v.model AS vehicle_model, v.trim AS vehicle_trim,
           v.vin AS vehicle_vin, v.plate AS vehicle_plate,
           v.current_mileage::text AS vehicle_mileage
    FROM grip.customers c
    LEFT JOIN grip.vehicles v ON v.customer_id = c.id
    ORDER BY c.display_name, v.created_at`);

  const headers = [
    "name", "email", "phone", "address", "city", "province", "postal_code", "notes",
    "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_trim", "vehicle_vin", "vehicle_plate", "vehicle_mileage",
  ];
  // Excel reads UTF-8 as the local codepage unless the file starts with a BOM,
  // which mangles any accented name. The importer strips it back off.
  const csv = "﻿" + toCsv(headers, rows.map((r) => headers.map((h) => r[h])));
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="grip-customers-${stamp}.csv"`,
    },
  });
}
