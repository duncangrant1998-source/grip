import { requireSession, inShop } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * What a shortcut code stands for, so the add-labour row can fill itself in as
 * soon as someone types an abbreviation. Read-only; applying a shortcut to an
 * order is a separate action.
 *
 *   GET /app/orders/shortcut?code=LOF
 *   -> { found: true, code, name, description, hours, rate, mode, taxable, parts }
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!can(session.role, "workorders.addLabour", session.extraRoles)) {
    return Response.json({ found: false }, { status: 403 });
  }

  const code = (new URL(request.url).searchParams.get("code") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(code)) return Response.json({ found: false });

  const result = await inShop(session, async (tx) => {
    const [sc] = await tx<{ id: string; code: string; name: string }[]>`
      SELECT id, code, name FROM grip.service_shortcuts WHERE code = ${code} AND is_active`;
    if (!sc) return null;

    const labour = await tx<
      { description: string; hours: string; rate: string | null;
        billing_mode: "flat_rate" | "straight_time" | null; is_taxable: boolean }[]
    >`SELECT description, hours, rate, billing_mode, is_taxable
      FROM grip.service_shortcut_labour WHERE shortcut_id = ${sc.id} ORDER BY sort_order, id`;
    const [parts] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM grip.service_shortcut_parts WHERE shortcut_id = ${sc.id}`;
    return { sc, labour, parts: parts.n };
  });

  if (!result) return Response.json({ found: false });
  const { sc, labour, parts } = result;

  // One labour line fills the row as it is. Several are folded into one: their
  // descriptions joined, their hours added, and a rate only if they agree on it.
  const rates = new Set(labour.map((l) => l.rate));
  const modes = new Set(labour.map((l) => l.billing_mode));
  return Response.json({
    found: true,
    code: sc.code,
    name: sc.name,
    description: labour.length > 0 ? labour.map((l) => l.description).join("; ") : sc.name,
    hours: labour.reduce((sum, l) => sum + Number(l.hours), 0),
    rate: rates.size === 1 ? [...rates][0] : null,
    mode: modes.size === 1 ? [...modes][0] : null,
    taxable: labour.every((l) => l.is_taxable),
    lines: labour.length,
    parts,
  });
}
