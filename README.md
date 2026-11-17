# Grip

Multi-tenant shop management software for small and independent automotive
repair and performance shops. Service, Parts and Administration in one web app,
joined by a shared live work order and a shared live parts inventory. Sold to
shops as a monthly subscription; every shop is its own isolated tenant.

**Status: phase 7 of 8 complete** — administration: staff and logins, shifts, time clock, timesheets,
reports (revenue, margin, effective labour rate, technician efficiency, projection) and shop settings. service shortcuts (type LOF, get the saved labour and parts), Service tabs (Schedule, Quotes, Open orders, Closed orders), delete-a-part-returns-it-to-stock, and wide-screen layouts. Ontario HST (editable rate, exempt option with a recorded reason, HST number on invoices), a month view on the schedule, and the site logo. a My Shop area for bays, hours, labour and tax. customer CSV import/export, an in-place work order (inline labour, ABV shortcuts, notes, edited-by), booking that opens its quote, parts by category with Open/Incoming work orders, a tabbed time clock with time-off requests, staff removal and a shifts calendar. 443 tests. Polish and deployment are next. See
[`docs/DESIGN.md`](docs/DESIGN.md) for the architecture, data model, permission
matrix, tenancy model and roadmap, and for the commercial notes on pricing and
billing.

## Stack

- **Next.js 15** (App Router) + TypeScript + Tailwind CSS
- **Postgres 17** with row-level security doing the tenant isolation
- **Drizzle ORM** for typed queries; migrations stay plain SQL so the RLS
  policies are readable
- Own session auth (Argon2id, signed httpOnly cookie)
- **Vitest** against a real database — tenant isolation cannot be tested
  against a mock

## Tenant isolation in one paragraph

Every tenant-owned table carries `tenant_id` and has RLS enabled. The app
connects as `grip_app`, a role with `NOBYPASSRLS` that owns nothing, and each
request runs inside a transaction that sets `app.tenant_id` and `app.user_id`
with `set_config(..., true)` — local to the transaction, so nothing leaks across
a pooled connection. Policies use both `USING` and `WITH CHECK`, so one tenant
can neither read nor write another's rows. Migrations and seeds use a separate
owner connection that does bypass RLS and is never reachable from a request.
`src/db/client.ts` is the only sanctioned way in.

## Running it

Requires Node 20+ (developed on 24) and a Postgres 17 database.

```bash
npm install
cp .env.example .env.local   # then fill in the two connection strings
```

`.env.local` needs:

| Variable | Role | Used by |
|---|---|---|
| `DATABASE_URL` | `grip_app` (restricted) | the app, at runtime |
| `DATABASE_URL_OWNER` | owner (bypasses RLS) | migrations, seeds, test fixtures |
| `SESSION_SECRET` | — | signs the session cookie |

Generate a session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Then:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

The app runs on <http://localhost:3100>.

> `db:migrate`, `db:seed` and the login flow arrive in phases 2–3. Today
> `npm run dev` serves a placeholder page.

## Tests

```bash
npm test
```

The suite that matters most covers tenant isolation (a tenant cannot read *or*
write across the boundary, enforced at the database layer) and the inventory
reservation logic, including two advisors racing for the last part in stock.

## Layout

```
docs/DESIGN.md      architecture, data model, roles, roadmap, commercial note
src/app/            Next.js App Router pages
src/db/client.ts    tenant-scoped connection helpers — read this first
src/db/             schema, migrations, seed (phase 2)
```

## Local database (Windows)

```powershell
winget install PostgreSQL.PostgreSQL.17
```

Create a `grip` database and a `grip_app` login role (`NOBYPASSRLS`), then point
`DATABASE_URL` at `grip_app` and `DATABASE_URL_OWNER` at `postgres` in
`.env.local`. Moving to hosted Postgres later (Supabase, RDS) is a connection
string change; with a transaction-mode pooler, add `prepare: false` to the
`postgres()` options in `src/db/client.ts`.

Demo logins after `npm run db:seed` (password `demo1234`): `service@`, `parts@`,
`tech@`, `admin@` at `redline.test` and `northside.test`, plus
`operator@grip.test` as platform super-admin.

## Platform console

`/platform` (link in the nav as "Platform", visible only to a platform admin)
is the operator's own backend: every shop, support tickets shops file from
their own account page, security events (five-plus failed sign-ins for one
email in 15 minutes, or a promotion to shop admin / platform admin), and
manual payment tracking ahead of Stripe (§8 of `docs/DESIGN.md`). Set
`RESEND_API_KEY` / `PLATFORM_NOTIFY_FROM` / `PLATFORM_NOTIFY_TO` to also email
the operator when a support request or security event comes in — unset,
everything still lands in the console's notification feed, just without the
email.
