import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { withoutTenant, withTenant } from "@/db/client";
import { getSession, type Session } from "./session";
import { redirect } from "next/navigation";
import { canAccessDepartment, type Department, type Role } from "./permissions";
import { emailPlatformAdmin } from "./notify";

// After this many consecutive failures (within the 15-minute window
// grip.record_login_attempt counts over) the attempt itself is flagged as a
// security event, once — not on every failure after, which would just spam
// the console and the operator's inbox for one person fumbling their
// password.
const FAILED_LOGIN_THRESHOLD = 5;

/** Logs one login attempt and, the moment the threshold is first crossed, raises a security event. */
async function recordLoginAttempt(
  email: string,
  tenantId: string | null,
  succeeded: boolean,
): Promise<void> {
  const [{ record_login_attempt: failures }] = await withoutTenant(
    (tx) => tx<{ record_login_attempt: number }[]>`
      SELECT grip.record_login_attempt(${email}, ${tenantId}, ${succeeded})`,
  );
  if (succeeded || failures !== FAILED_LOGIN_THRESHOLD) return;

  const title = `Repeated failed sign-ins for ${email}`;
  const body =
    `${email} has failed to sign in ${failures} times in the last 15 minutes` +
    (tenantId ? "." : ", against no matching account.");
  const [{ log_security_event: eventId }] = await withoutTenant(
    (tx) => tx<{ log_security_event: string }[]>`
      SELECT grip.log_security_event(
        'failed_logins', ${tenantId}, NULL, ${JSON.stringify({ email, failures })}::jsonb,
        ${title}, ${body})`,
  );
  if (eventId) await emailPlatformAdmin({ title, body });
}

type LoginRow = {
  user_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
  password_hash: string;
  full_name: string;
  role: Role;
  is_platform_admin: boolean;
};

// A real argon2id hash of a throwaway string. Verifying against it when no user
// matches keeps "unknown email" and "wrong password" the same speed, so the
// login form cannot be used to discover which emails have accounts.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash("grip-timing-equaliser"));

export type LoginResult =
  | { ok: true; userId: string; sessionId: string }
  | { ok: false; reason: "invalid" | "needs_shop" | "suspended" };

/**
 * Email addresses are unique per shop, not globally — the same mechanic may
 * work at two shops. So a login can match several accounts. We verify the
 * password against each; if exactly one matches we are done, and if more than
 * one matches we ask which shop rather than guessing.
 */
export async function authenticate(
  email: string,
  password: string,
  shopSlug?: string,
): Promise<LoginResult> {
  const candidates = await withoutTenant(
    (tx) => tx<LoginRow[]>`SELECT * FROM grip.find_users_for_login(${email})`,
  );

  const scoped = shopSlug
    ? candidates.filter((c) => c.tenant_slug === shopSlug.trim().toLowerCase())
    : candidates;

  if (scoped.length === 0) {
    await verify(await getDummyHash(), password).catch(() => false);
    await recordLoginAttempt(email, null, false);
    return { ok: false, reason: "invalid" };
  }

  const matches: LoginRow[] = [];
  for (const c of scoped) {
    if (await verify(c.password_hash, password).catch(() => false)) matches.push(c);
  }

  if (matches.length === 0) {
    // Scoped to exactly one shop (the common case), that attempt is
    // attributable to it; scoped to several, which shop was "meant" is
    // ambiguous, so the attempt is logged without one.
    await recordLoginAttempt(email, scoped.length === 1 ? scoped[0].tenant_id : null, false);
    return { ok: false, reason: "invalid" };
  }
  if (matches.length > 1) return { ok: false, reason: "needs_shop" };

  const user = matches[0];
  if (user.tenant_status === "cancelled") return { ok: false, reason: "suspended" };
  await recordLoginAttempt(email, user.tenant_id, true);

  const ttl = Number(process.env.SESSION_TTL_DAYS ?? 14);
  const [{ create_session: sessionId }] = await withoutTenant(
    (tx) => tx<{ create_session: string }[]>`
      SELECT grip.create_session(${user.user_id}, ${ttl}, NULL)`,
  );

  return { ok: true, userId: user.user_id, sessionId };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireDepartment(dept: Department): Promise<Session> {
  const session = await requireSession();
  if (!canAccessDepartment(session.role, dept, session.extraRoles)) redirect("/app?denied=" + dept);
  return session;
}

export async function requirePlatformAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!session.isPlatformAdmin) redirect("/app");
  return session;
}

/** Run a query scoped to the signed-in user's shop. */
export function inShop<T>(
  session: Session,
  fn: Parameters<typeof withTenant<T>>[1],
): Promise<T> {
  return withTenant(
    {
      tenantId: session.tenantId,
      userId: session.userId,
      isPlatformAdmin: session.isPlatformAdmin,
    },
    fn,
  );
}
