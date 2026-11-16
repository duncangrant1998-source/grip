import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * A fast front door, not the lock. This turns away requests with no valid
 * signed cookie before any page renders. Whether the session is still live,
 * and what the user may see, is decided by the database on every request —
 * see getSession() and the requireDepartment() guards.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("grip_session")?.value;

  let valid = false;
  if (token && process.env.SESSION_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET), {
        algorithms: ["HS256"],
      });
      valid = true;
    } catch {
      valid = false;
    }
  }

  if (!valid) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const res = NextResponse.redirect(url);
    if (token) res.cookies.delete("grip_session");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/platform/:path*"],
};
