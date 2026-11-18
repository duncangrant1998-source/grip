import "server-only";
import { inShop } from "./auth";
import type { Session } from "./session";

// Every query here depends on the session carrying isPlatformAdmin — RLS
// (0022) is what actually enforces that; requirePlatformAdmin() in auth.ts
// is the gate every page below sits behind before it ever calls these.

export type ShopRow = {
  id: string; name: string; slug: string; plan: string; status: string;
  city: string | null; province: string | null; postal_code: string | null;
  trial_ends_at: Date | null;
  users: string; orders: string; orders_last_30d: string;
  last_activity_at: Date | null;
};

// Counts and timestamps come from grip.platform_shop_stats(), a
// SECURITY DEFINER aggregate (0023) — not from reading grip.users /
// grip.work_orders directly, which a platform admin can no longer do for a
// shop that hasn't granted access. The join below never touches those
// tables' actual rows, only the numbers the function hands back.
export function listShops(session: Session) {
  return inShop(
    session,
    (tx) => tx<ShopRow[]>`
      SELECT t.id, t.name, t.slug, t.plan, t.status,
             t.city, t.province, t.postal_code, t.trial_ends_at,
             coalesce(s.users, 0)::text AS users,
             coalesce(s.orders, 0)::text AS orders,
             coalesce(s.orders_last_30d, 0)::text AS orders_last_30d,
             s.last_activity_at
      FROM grip.tenants t
      LEFT JOIN grip.platform_shop_stats() s ON s.tenant_id = t.id
      ORDER BY t.created_at`,
  );
}

export type SupportAccessGrantRow = {
  id: string; tenant_id: string; shop_name: string;
  granted_by_name: string | null; note: string | null;
  expires_at: Date; revoked_at: Date | null; created_at: Date;
};

/** Every grant, across shops if called by the operator — metadata only (no shop content). */
export function listSupportAccessGrants(session: Session) {
  return inShop(
    session,
    (tx) => tx<SupportAccessGrantRow[]>`
      SELECT g.id, g.tenant_id, t.name AS shop_name, u.full_name AS granted_by_name,
             g.note, g.expires_at, g.revoked_at, g.created_at
      FROM grip.support_access_grants g
      JOIN grip.tenants t ON t.id = g.tenant_id
      LEFT JOIN grip.users u ON u.id = g.granted_by_user_id
      ORDER BY (g.revoked_at IS NULL AND g.expires_at > now()) DESC, g.created_at DESC`,
  );
}

export function grantSupportAccess(session: Session, hours: number, supportRequestId: string | null, note: string | null) {
  return inShop(
    session,
    (tx) => tx<{ id: string; expires_at: Date }[]>`
      SELECT * FROM grip.grant_support_access(${hours}, ${supportRequestId}, ${note})`,
  );
}

export function revokeSupportAccess(session: Session, id: string) {
  return inShop(session, (tx) => tx`SELECT grip.revoke_support_access(${id})`);
}

export type TenantOption = { id: string; name: string; slug: string };

export function listTenantOptions(session: Session) {
  return inShop(
    session,
    (tx) => tx<TenantOption[]>`SELECT id, name, slug FROM grip.tenants ORDER BY name`,
  );
}

// --- support requests ----------------------------------------------------------------

export type SupportRequestRow = {
  id: string; tenant_id: string; shop_name: string; subject: string; message: string;
  status: "open" | "in_progress" | "resolved";
  created_by_name: string | null; created_at: Date;
  resolved_at: Date | null; resolved_by_name: string | null;
};

export function listSupportRequests(session: Session) {
  return inShop(
    session,
    (tx) => tx<SupportRequestRow[]>`
      SELECT r.id, r.tenant_id, t.name AS shop_name, r.subject, r.message, r.status,
             cu.full_name AS created_by_name, r.created_at,
             r.resolved_at, ru.full_name AS resolved_by_name
      FROM grip.support_requests r
      JOIN grip.tenants t ON t.id = r.tenant_id
      LEFT JOIN grip.users cu ON cu.id = r.created_by_user_id
      LEFT JOIN grip.users ru ON ru.id = r.resolved_by_user_id
      ORDER BY (r.status = 'resolved'), r.created_at DESC`,
  );
}

export function listOwnSupportRequests(session: Session) {
  return inShop(
    session,
    (tx) => tx<Omit<SupportRequestRow, "shop_name" | "tenant_id">[]>`
      SELECT r.id, r.subject, r.message, r.status, cu.full_name AS created_by_name,
             r.created_at, r.resolved_at, ru.full_name AS resolved_by_name
      FROM grip.support_requests r
      LEFT JOIN grip.users cu ON cu.id = r.created_by_user_id
      LEFT JOIN grip.users ru ON ru.id = r.resolved_by_user_id
      WHERE r.tenant_id = ${session.tenantId}
      ORDER BY r.created_at DESC
      LIMIT 20`,
  );
}

// --- security events -------------------------------------------------------------------

export type SecurityEventRow = {
  id: string; kind: "failed_logins" | "privilege_grant";
  tenant_id: string | null; shop_name: string | null;
  user_id: string | null; user_name: string | null;
  details: Record<string, unknown>; created_at: Date;
};

export function listSecurityEvents(session: Session, limit = 100) {
  return inShop(
    session,
    (tx) => tx<SecurityEventRow[]>`
      SELECT e.id, e.kind, e.tenant_id, t.name AS shop_name,
             e.user_id, u.full_name AS user_name, e.details, e.created_at
      FROM grip.security_events e
      LEFT JOIN grip.tenants t ON t.id = e.tenant_id
      LEFT JOIN grip.users u ON u.id = e.user_id
      ORDER BY e.created_at DESC
      LIMIT ${limit}`,
  );
}

// --- payments ----------------------------------------------------------------------

export type PaymentRow = {
  id: string; tenant_id: string; shop_name: string;
  amount: string; currency: string;
  period_start: string | null; period_end: string | null; due_date: string | null;
  status: "paid" | "due" | "overdue" | "waived";
  paid_at: Date | null; note: string | null; created_at: Date;
};

export function listPayments(session: Session) {
  return inShop(
    session,
    (tx) => tx<PaymentRow[]>`
      SELECT p.id, p.tenant_id, t.name AS shop_name, p.amount, p.currency,
             p.period_start, p.period_end, p.due_date, p.status, p.paid_at, p.note, p.created_at
      FROM grip.payments p
      JOIN grip.tenants t ON t.id = p.tenant_id
      ORDER BY (p.status IN ('due', 'overdue')) DESC, p.due_date NULLS LAST, p.created_at DESC`,
  );
}

export type PaymentSummary = { due: number; overdue: number; paid_last_30d: string };

export function paymentSummary(session: Session) {
  return inShop(session, async (tx) => {
    const [row] = await tx<{ due: string; overdue: string; paid_last_30d: string }[]>`
      SELECT
        count(*) FILTER (WHERE status = 'due') AS due,
        count(*) FILTER (WHERE status = 'overdue') AS overdue,
        coalesce(sum(amount) FILTER (WHERE status = 'paid' AND paid_at > now() - interval '30 days'), 0) AS paid_last_30d
      FROM grip.payments`;
    return { due: Number(row.due), overdue: Number(row.overdue), paid_last_30d: row.paid_last_30d } satisfies PaymentSummary;
  });
}

// --- notifications -------------------------------------------------------------------

export type NotificationRow = {
  id: string; kind: "support_request" | "security_event";
  tenant_id: string | null; shop_name: string | null;
  title: string; body: string; is_read: boolean;
  support_request_id: string | null; security_event_id: string | null;
  created_at: Date;
};

export function listNotifications(session: Session, onlyUnread = false) {
  return inShop(
    session,
    (tx) => tx<NotificationRow[]>`
      SELECT n.id, n.kind, n.tenant_id, t.name AS shop_name, n.title, n.body, n.is_read,
             n.support_request_id, n.security_event_id, n.created_at
      FROM grip.platform_notifications n
      LEFT JOIN grip.tenants t ON t.id = n.tenant_id
      ${onlyUnread ? tx`WHERE NOT n.is_read` : tx``}
      ORDER BY n.created_at DESC
      LIMIT 200`,
  );
}

export function unreadNotificationCount(session: Session) {
  return inShop(session, async (tx) => {
    const [row] = await tx<{ count: string }[]>`
      SELECT count(*) FROM grip.platform_notifications WHERE NOT is_read`;
    return Number(row.count);
  });
}
