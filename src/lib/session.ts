import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { withoutTenant } from "@/db/client";
import type { Role } from "./permissions";

export const SESSION_COOKIE = "grip_session";

export type Session = {
  sessionId: string;
  userId: string;
  tenantId: string;
  tenantSlug: string;
  role: Role;
  fullName: string;
  isPlatformAdmin: boolean;
};

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

/**
 * The cookie carries only a signed session id — no role, no tenant. Everything
 * authoritative is looked up from the database on each request, so revoking a
 * session or deactivating a user takes effect immediately rather than when a
 * token expires. The signature just lets us discard forged cookies without a
 * database round trip.
 */
export async function setSessionCookie(sessionId: string, ttlDays: number) {
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlDays}d`)
    .sign(key());

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlDays * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function readSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}

/** Resolved once per request, however many components ask. */
export const getSession = cache(async (): Promise<Session | null> => {
  const sessionId = await readSessionId();
  if (!sessionId) return null;

  const rows = await withoutTenant(
    (tx) => tx<
      {
        user_id: string;
        tenant_id: string;
        role: Role;
        full_name: string;
        tenant_slug: string;
        is_platform_admin: boolean;
      }[]
    >`SELECT * FROM grip.resolve_session(${sessionId})`,
  );

  const row = rows[0];
  if (!row) return null;

  return {
    sessionId,
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    role: row.role,
    fullName: row.full_name,
    isPlatformAdmin: row.is_platform_admin,
  };
});
