import "server-only";
import { inShop } from "./auth";
import type { Session } from "./session";

export type AddonKey = "client_messaging";
export type AddonStatus = "requested" | "active" | "suspended";

export type ShopAddon = {
  status: AddonStatus;
  requested_at: Date | null;
  granted_at: Date | null;
  note: string | null;
} | null;

/** This shop's own row for one add-on, or null if it's never been requested. */
export function tenantAddon(session: Session, key: AddonKey) {
  return inShop(session, async (tx) => {
    const [row] = await tx<NonNullable<ShopAddon>[]>`
      SELECT status, requested_at, granted_at, note
      FROM grip.shop_addons WHERE tenant_id = ${session.tenantId} AND addon_key = ${key}`;
    return row ?? null;
  });
}

export async function addonIsActive(session: Session, key: AddonKey): Promise<boolean> {
  const row = await tenantAddon(session, key);
  return row?.status === "active";
}

export type ClientMessageRow = {
  id: string; channel: "email" | "sms"; to_address: string; body: string;
  status: "queued" | "sent" | "failed"; failure_reason: string | null;
  sent_by_name: string | null; created_at: Date;
};

export function listClientMessages(session: Session, workOrderId: string) {
  return inShop(session, (tx) => tx<ClientMessageRow[]>`
    SELECT m.id, m.channel, m.to_address, m.body, m.status, m.failure_reason,
           u.full_name AS sent_by_name, m.created_at
    FROM grip.client_messages m
    LEFT JOIN grip.users u ON u.id = m.sent_by
    WHERE m.work_order_id = ${workOrderId}
    ORDER BY m.created_at DESC`);
}

// --- platform console --------------------------------------------------------------

export type ShopAddonRow = {
  tenant_id: string; shop_name: string; addon_key: AddonKey; status: AddonStatus;
  requested_at: Date | null; granted_at: Date | null; note: string | null;
};

/** Every shop that has ever requested or been granted this add-on, newest request first. */
export function listAddonRequests(session: Session, key: AddonKey) {
  return inShop(session, (tx) => tx<ShopAddonRow[]>`
    SELECT a.tenant_id, t.name AS shop_name, a.addon_key, a.status,
           a.requested_at, a.granted_at, a.note
    FROM grip.shop_addons a
    JOIN grip.tenants t ON t.id = a.tenant_id
    WHERE a.addon_key = ${key}
    ORDER BY a.requested_at DESC NULLS LAST`);
}

/** Shops with no row yet for this add-on at all — for a "grant directly" picker. */
export function listTenantsWithoutAddon(session: Session, key: AddonKey) {
  return inShop(session, (tx) => tx<{ id: string; name: string }[]>`
    SELECT t.id, t.name FROM grip.tenants t
    WHERE NOT EXISTS (
      SELECT 1 FROM grip.shop_addons a WHERE a.tenant_id = t.id AND a.addon_key = ${key})
    ORDER BY t.name`);
}
