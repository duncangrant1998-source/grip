# Grip — Design Document

> Working name. Multi-tenant shop management SaaS for small and independent
> automotive repair and performance shops, sold as a monthly subscription.

Status: **draft for review** — nothing below is locked in. Phase 1 (this document
plus the repo skeleton) is deliberately cheap to change.

---

## 1. Product shape

One web application. A shop signs up, gets its own tenant, and invites staff.
Every staff member logs in with their own credentials and lands in their shop's
portal. Nobody ever sees another shop's data.

The product is three linked areas:

| Area | Who lives here | Core objects |
|---|---|---|
| **Service** | Service advisors, technicians | Appointments, work orders, customers, vehicles, labour lines |
| **Parts** | Parts advisors / counter staff | Inventory, suppliers, purchase orders, counter sales, part lines |
| **Administration** | Shop owner / manager | Employees, shifts, clocked hours, margin reporting |
| **My Shop** | Shop owner / manager | The premises itself: bays, hours, labour rate, tax, what prints on a document |

The spine that joins Service and Parts is the **work order**. A service advisor
opens it and adds labour; a parts advisor adds parts to the *same* live document
from the parts counter; allocating a part reserves live inventory immediately.
Both sides see each other's lines in real time, and every line records who added
it and when.

---

## 2. Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | One deployable for UI and API; server components keep tenant-scoped queries on the server; React is already familiar |
| Styling | **Tailwind CSS** + a small local component set | No heavyweight UI dependency to fight later |
| Database | **Postgres 17** (Supabase-hosted) | Row-level security is the whole tenancy story; Postgres does it natively |
| Schema / queries | **Drizzle ORM** + SQL migrations | Typed queries, but migrations stay plain SQL so RLS policies are readable and reviewable |
| Auth | **Own session auth** — Argon2id password hashes, signed httpOnly cookie | Keeps the app portable to any Postgres; department/role logic lives in our own tables rather than a vendor's |
| Tests | **Vitest** against a real Postgres | Tenant isolation cannot be tested against a mock. Isolation tests run as the restricted app role with real session variables |
| Hosting (later) | Vercel + Supabase, or a single container on Railway | Both already available; decide at deploy time, nothing in the code assumes either |

**Why not Supabase Auth / PostgREST?** We need per-department permissions,
seat-based billing and an audit trail that belongs to us. Supabase here is simply
very good managed Postgres; swapping it for RDS later is a connection-string
change.

---

## 3. Tenancy model

**Shared database, shared schema, row-level security.** Every tenant-owned table
carries a non-null `tenant_id`. Isolation is enforced by Postgres, not by
application code remembering to add a `WHERE` clause.

### How a request is scoped

1. The request arrives with a session cookie. The server verifies it and loads
   `{ user_id, tenant_id, role, is_platform_admin }`.
2. The query runs inside a transaction that first does:

   ```sql
   SELECT set_config('app.tenant_id', $1, true);   -- true = LOCAL, dies with the txn
   SELECT set_config('app.user_id',   $2, true);
   SELECT set_config('app.is_platform_admin', $3, true);
   ```
3. The app connects as **`grip_app`**, a role with `NOBYPASSRLS` and no
   ownership of any table. It cannot see past a policy even with a crafted query.
4. Every policy reads the setting:

   ```sql
   CREATE POLICY tenant_isolation ON work_orders
     USING (tenant_id = current_tenant_id())
     WITH CHECK (tenant_id = current_tenant_id());
   ```

`current_tenant_id()` is a `STABLE` helper that returns the GUC as uuid, and
**raises** if it is missing — an unscoped connection gets an error rather than
silently seeing nothing (a silent empty result set hides bugs; an exception does
not).

### Three things this buys

- A forgotten `WHERE tenant_id = ...` is harmless.
- `WITH CHECK` means a tenant cannot *write* a row into another tenant either —
  the attack that pure read-side filtering misses.
- Platform super-admins are a deliberate, auditable exception: policies are
  `USING (tenant_id = current_tenant_id() OR current_is_platform_admin())`, and
  that flag is only ever set for a user whose `platform_admins` row exists.

### Migrations and seeds
Run as the **owner** role (which does bypass RLS). The app never uses that role.

---

## 4. Data model

Abbreviated; every tenant table also has `tenant_id uuid not null`,
`created_at`, `updated_at`.

### Identity and tenancy
- **tenants** — `id`, `name`, `slug`, `plan`, `status`, `trial_ends_at`
- **users** — `id`, `tenant_id`, `email`, `password_hash`, `full_name`, `role`,
  `is_active`. Unique on `(tenant_id, lower(email))` — the same person can exist
  at two shops.
- **platform_admins** — `user_id`. Rows here are the SaaS operator, not a shop.
- **sessions** — `id`, `user_id`, `expires_at`, `revoked_at`

### Service
- **customers** — name, phone, email, address
- **vehicles** — `customer_id`, `vin`, `year`, `make`, `model`, `plate`,
  `engine`, `current_mileage`
- **appointments** — `vehicle_id`, `bay_id`, `assigned_tech_id`, `starts_at`,
  `estimated_minutes`, `status`, `concern`
- **bays** — shop's physical bays; capacity for the calendar. Deleting one is
  only allowed while nothing has ever been booked into it (`grip.delete_bay`);
  after that it is retired instead, because `appointments.bay_id` is
  ON DELETE SET NULL and a plain delete would strip the bay off historic work
- **work_orders** — `number`, `customer_id`, `vehicle_id`, `status`
  (`quote → approved → in_progress → completed → invoiced → paid`, plus
  `cancelled`), `mileage_in`, `opened_by`, `service_advisor_id`,
  `appointment_id`, totals (denormalised, recomputed on change)
- **work_order_labour_lines** — `description`, `billed_hours`, `actual_hours`,
  `rate`, `billing_mode`, `tech_id`, `added_by_user_id`, `is_taxable`
- **work_order_part_lines** — `part_id`, `qty`, `unit_cost`, `unit_price`,
  `added_by_user_id`, `reservation_id`, `is_taxable`
- **vehicle_service_history** — derived view over completed work orders

### The work order is edited in place

Every field on a labour line is a live text box that saves when you click away —
description, billed and actual hours, rate, amount, billing mode, tax and
technician — and each line remembers who last changed it (`edited_by_user_id`),
so the page reads "Added by" until someone else edits it, then "Edited by".
Labour stays editable until the order is **invoiced** (hours are corrected when a
job is closed out); parts lock at **completed**, because completing uses them up.
Notes for the customer, the concern and the mileage are plain text and stay
editable; the customer and vehicle can be changed until the order is issued, and
a different customer brings their own tax arrangement with them.

**Booking an appointment starts its work order.** The appointment and a linked
quote are created together (`grip.create_appointment_with_order`) and the person
lands on the order. The appointment stays "scheduled" — nobody has arrived — and
cancelling it cancels the quote if nothing has been put on it. This is what lets
the parts desk see **Incoming work orders** (booked, not here yet) as well as
**Open work orders** (in the shop now).

### Staff, time and time off

Removing someone closes their login for good (password destroyed, sessions
ended, email freed) but **never deletes** them: the person stays on file with
their pay, hours and history, because a deleted user row would turn every "added
by Sam Reyes" in the shop's history into a blank. A shop must keep one active
administrator, and nobody removes themselves; both rules live in the database.

Clocking in is either **hourly** or **on a job**. Time-off requests go to the
administrator or to a person chosen, are answered by them (or any administrator,
never by the person asking), and refuse overlapping days.

Customers and their vehicles import and export as a single CSV, one row per
vehicle with the customer repeated (`src/lib/csv.ts`, `/app/customers/export`).
An import only ever adds: customers already on file are matched by name and
left alone, a duplicate VIN is skipped, and every unusable row is reported with
its line number rather than failing the whole file.
- **service_shortcuts** (+ `_labour`, `_parts`) — a short code such as `LOF` that holds
  saved labour lines (hours, optional rate and billing mode) and/or parts (qty).
  `grip.apply_service_shortcut` adds them to an open work order in one step: labour
  at the shop rate unless the shortcut sets its own, parts priced and reserved from
  live stock (short parts go on backorder). Each half is only applied if the
  caller's role may add it, and the use is written to the audit log.

### Parts
- **parts** — `sku`, `description`, `category`, `bin_location`, `unit_cost`,
  `unit_price`, `reorder_point`, `reorder_qty`, `supplier_id`
- **part_stock** — `part_id`, `qty_on_hand`, `qty_reserved`, `qty_on_order`.
  Split from `parts` so stock mutations lock a narrow row.
- **stock_movements** — append-only ledger: `part_id`, `delta`, `kind`
  (`receive | reserve | release | consume | adjust | sale`), `ref_type`,
  `ref_id`, `user_id`, `note`. **Quantities are derived from and reconciled
  against this ledger** — it is the audit trail, not a log.
- **suppliers**, **purchase_orders**, **purchase_order_lines**
- **counter_sales**, **counter_sale_lines** — parts sold with no work order
- **stock_adjustments** — cycle counts, shrinkage, with reason codes

### Administration
- **employees** — `user_id` (nullable: a tech may not need a login), `hourly_rate`,
  `billable_rate`, `employment_type`
- **shifts** — scheduled `starts_at`/`ends_at`
- **time_entries** — `clock_in`, `clock_out`, `work_order_id` (nullable)
- **tenant_settings** — shop name/address, default labour rate, default
  `labour_billing_mode`, default `tax_rate_id`, `hst_number`, logo,
  invoice footer
- **audit_log** — `actor_user_id`, `action`, `entity`, `entity_id`, `diff`

### Tax — Ontario HST, selectable per document

Grip is sold to Ontario shops, so tax is not a build-your-own affair. Every
shop gets exactly two choices and edits one number:

- **HST** — the default, charged on labour and parts. The percentage is
  editable (migration 0010, `grip.set_hst_rate`) because Ontario's has moved
  before and will again; it ships at 13%.
- **Exempt** — charges nothing. For status-card holders and other accounts
  that don't pay HST. Set it on a customer so all their work is exempt, or on
  a single quote or invoice.

**Charging no HST is a claim the shop has to back up**, so an exemption carries
a reason (`grip.exempt_reason`: status card, government, resale, export, the
shop's own vehicle, other) and, for the three that have one, a number — a card,
a government account, the purchaser's HST number. The reason lives on the
customer where it is a standing arrangement, with an optional expiry, and is
copied onto each document, so the invoice prints what was true when it was
issued exactly as the tax amounts do.

One rule enforces it: **an exempt work order cannot be invoiced, and an exempt
counter sale cannot be completed, until a reason is recorded.** The gate is at
the moment the document is issued, not when the rate is chosen, so a quote can
be drafted first. A customer's chosen rate always carries over — if the shop
marked them exempt, the order is exempt — but a *lapsed* expiry stops the
reason carrying, leaving the order exempt and unexplained until someone records
the renewal. The rate never changes under the shop; the gate catches it.

An HST rate a shop has set to 0% is **not** exempt (`grip.rate_is_exempt`), so a
shop below the registration threshold is never asked to justify every invoice.

A shop's CRA business number (`tenant_settings.hst_number`, e.g.
`123456789RT0001`) prints on every invoice and receipt, which the CRA requires
of a registered business.

The storage is deliberately general: two tables, unchanged from when shops
defined their own rates.

- **tax_rates** — `name` ("HST", "Exempt"), `applies_to_labour`,
  `applies_to_parts`, `is_default`, `is_active`
- **tax_rate_components** — `tax_rate_id`, `name`, `rate_bps`, `sort_order`

A rate is a *set* of components. Ontario needs only one, but keeping the table
means HST prints as its own named line ("HST 13%") rather than an unexplained
number, and leaves the door open if the province ever splits it again. Rates
are stored in **basis points** (integers) — no floating point anywhere near
money. `grip.create_ontario_tax_rates(tenant)` gives a new shop the pair.

Changing the rate re-prices open quotes and work orders immediately, so a
document never sits on a stale rate and then jumps the moment someone adds a
line to it. Issued invoices and completed sales are never touched — see below.

Every work order, counter sale and purchase order carries a `tax_rate_id`,
defaulted from `tenant_settings` and **changeable on the document** by whoever
is writing it up. Totals recompute automatically on every line change. Each
line also has an `is_taxable` flag, so a single exempt item (shop supplies, a
warranty job, a tax-exempt fleet customer) doesn't force a different rate.

Calculation, per document:

```
for each component c in the selected rate:
    base = Σ(taxable labour) if c.applies_to_labour
         + Σ(taxable parts)  if c.applies_to_parts
    tax_c = round_half_up(base * c.rate_bps / 10000)
total = subtotal + Σ tax_c
```

Component amounts are stored on the document (`work_order_taxes`) so a
reprinted invoice from two years ago shows the tax that was actually charged,
not today's rate. Editing a tax rate never rewrites history.

### Labour — flat rate or straight time, shop's choice

`tenant_settings.labour_billing_mode` is `flat_rate` or `straight_time`, and
it is overridable **per work order and per line** — plenty of shops bill book
time on diagnostics and actual time on a teardown.

Every labour line stores both numbers:

- `billed_hours` — what the customer pays for. In `flat_rate` this is book
  time the advisor enters; in `straight_time` it mirrors `actual_hours`.
- `actual_hours` — what the tech actually took, from `time_entries`.

Billing always uses `billed_hours × rate`, so the modes differ only in how
`billed_hours` gets its value. Keeping both columns unconditionally means
**technician efficiency works identically in either mode**:

```
efficiency = Σ billed_hours / Σ actual_hours
```

Over 100% means the tech is beating book time. A straight-time shop will sit
near 100% by construction, which is correct and still worth showing.

### The inventory reservation rule

This is the second thing (after tenant isolation) that must be exactly right.

```
available = qty_on_hand - qty_reserved
```

- Adding a part line to a **quote or active** work order writes a `reserve`
  movement and increments `qty_reserved`. Stock is not yet gone, but nobody else
  can promise it.
- Removing the line, or cancelling the order, writes `release`.
- Completing the work order converts reservation to consumption: `consume`
  decrements `qty_on_hand` *and* `qty_reserved`.
- A counter sale skips reservation and goes straight to `sale`.
- Every mutation runs in one transaction with `SELECT ... FOR UPDATE` on the
  `part_stock` row. Two advisors grabbing the last alternator cannot both win.
- Going below zero available is allowed only with an explicit `allow_backorder`
  flag, which records the shortfall on the line so the parts side sees it.

---

## 5. Roles and permissions

Five roles. A user has exactly one, plus the orthogonal platform-admin flag.

| | service_advisor | technician | parts_advisor | shop_admin | platform_admin |
|---|---|---|---|---|---|
| View appointments | ✅ | own only | — | ✅ | ✅ |
| Create/edit appointments | ✅ | — | — | ✅ | ✅ |
| Create work order | ✅ | — | ✅ | ✅ | ✅ |
| Add **labour** line | ✅ | own only | — | ✅ | ✅ |
| Add **part** line | ✅ | — | ✅ | ✅ | ✅ |
| Change WO status | ✅ | to `in_progress`/`completed` | — | ✅ | ✅ |
| Convert quote → invoice | ✅ | — | — | ✅ | ✅ |
| View part **cost** | — | — | ✅ | ✅ | ✅ |
| Edit inventory / receive PO | — | — | ✅ | ✅ | ✅ |
| Counter sale | — | — | ✅ | ✅ | ✅ |
| Create purchase order | — | — | ✅ | ✅ | ✅ |
| Employees, rates, shifts | — | — | — | ✅ | ✅ |
| Margin reporting | — | — | parts only | ✅ | ✅ |
| Tenant settings | — | — | — | ✅ | ✅ |
| Manage service shortcuts | — | — | ✅ | ✅ | ✅ |
| Cross-tenant access | — | — | — | — | ✅ |

Notes:
- **Service and parts both write to the live work order.** That is the point of
  the product. `added_by_user_id` on every line, surfaced in the UI as
  "Parts — J. Kerr, 10:42", is the audit trail the brief asks for.
- Technicians get a deliberately narrow view: their own jobs, their own hours.
- Part **cost** is hidden from service so margin isn't visible at the service
  desk; sell price is not.
- Permissions are enforced in a single `can(user, action, resource)` module used
  by every route handler — *and* separately by RLS for the tenant boundary. Role
  checks are app-layer; tenant isolation is database-layer. The brief's
  non-negotiable is the second one.

**The role picker.** The table above is the default for *one* role, not a
ceiling on how many a login can have. Small shops often want to bend it — a
technician who also covers the parts counter, a service advisor who can see
parts info — so the Staff tab's role picker (the "Roles" dropdown beside each
name, and the same control on a staff member's own page) lets an admin tick
any combination of the four roles for a login, not just one. Ticking a role
adds everything that role's row of the table above grants; unticking one
removes only what that role alone granted — something another ticked role
still grants stays granted. It never creates a new named role: one ticked role
is stored as the login's primary `role` (what the technician-billing flag and
the Role label default from) and the rest as `grip.users.extra_roles`; `can()`
/ `canAccessDepartment()` / `canTransition()` (`src/lib/permissions.ts`) treat
every ticked role identically regardless of which one is "primary." Changes
take effect immediately, since the full set is resolved fresh from the
session on every request.

**The shop owner.** Every tenant has exactly one `is_shop_owner` login —
automatically the first `shop_admin` it ever gets — whose access can never be
changed from the Staff tab, by anyone, including itself: no role picker, no
deactivating, no removing from staff. `grip.update_user_access` and
`grip.remove_employee` both refuse outright if the target is the owner. This
is the shop's one access invariant that cannot be reasoned around by a
confused or malicious admin — every other `shop_admin` can be demoted,
deactivated or removed (subject to "a shop must always keep at least one
active administrator"), but the owner is permanent by construction.

---

## 6. MVP scope

**In** (what "first working version" means):
- Login, logout, session cookie, seeded demo tenants with one user per role
- Tenant portal shell: nav scoped to the user's role
- Customers and vehicles, with service history on the vehicle
- Appointment calendar — week view, bay columns, drag to assign tech, duration
- Work orders: create as quote, labour lines, part lines, totals with tax,
  approve, convert to invoice, printable/PDF-able invoice view
- Inventory: parts list, stock levels showing on-hand / reserved / available,
  adjustments, reorder-point flagging
- Reservation on allocation, release on removal, consume on completion
- Suppliers and purchase orders through to receiving
- Counter sales
- Employees, hourly rates, shifts, clock in/out
- Reporting: revenue by period, labour vs parts margin, effective labour rate,
  technician efficiency
- Tenant settings: shop details, tax rate, default labour rate, branding
- Platform-admin view: list tenants, impersonate-with-audit
- Tests: tenant isolation (RLS), reservation concurrency, quote→invoice totals

**Out of MVP, deliberately:**
- Stripe billing (designed in §8, not wired)
- Customer-facing portal / online booking
- SMS and email notifications
- Parts supplier catalogue integrations (WorldPAC, Turn 14, etc.)
- VIN decode API, labour-time guides (Mitchell/Alldata)
- Accounting sync (QuickBooks)
- Mobile app — the UI is responsive, that is enough for now
- Multi-location tenants (one shop per tenant for now; the schema leaves room)

---

## 7. Phased roadmap

| Phase | Contents | Done when |
|---|---|---|
| **1** | This doc, repo, stack skeleton | ← you are here |
| **2** | Postgres schema + RLS + the `grip_app` role, migrations, seed script, isolation tests | A test proves tenant A cannot read or write tenant B, as the app role |
| **3** | Auth, session, tenant portal shell, role-scoped nav | Log in as each seeded role and land in the right portal |
| **4** | Work order spine: customers, vehicles, WO, labour lines, quote→invoice | A quote becomes an invoice with correct totals |
| **5** | Parts: inventory, reservation engine, part lines on WO, counter sales | Reservation tests pass, including the concurrency case |
| **6** | Scheduling: appointment calendar, bays, tech assignment | Book a job, it appears on the calendar and opens a WO |
| **7** | Admin: employees, shifts, time clock, margin reporting, settings | Reports reconcile against seeded data |
| **8** | Polish, platform-admin console, deploy | Running on a URL |

Check in with you at the end of each phase.

---

## 8. Commercial note (brief, secondary)

**Shape.** Per-shop monthly subscription, priced on seats and feature tier.
Small shops are price-sensitive and compare against Shop-Ware, Tekmetric and
Mitchell 1, which sit roughly in the $200–$500/month range for a full shop.
Undercutting on price while matching the service↔parts live-link is the wedge.

**Suggested tiers** (annual ~2 months free):

| Tier | Price/mo | Seats | For |
|---|---|---|---|
| **Solo** | $89 | 2 | One-bay / mobile tech. Work orders, invoicing, basic inventory |
| **Shop** | $219 | 8 | The core product. Scheduling, full parts, PO/receiving, reporting |
| **Performance** | $399 | 20 | Multi-bay and performance shops. Build sheets, custom labour matrices, API access |
| **Enterprise** | quote | — | Multi-location, SSO, data export SLAs |

Extra seats $15/mo. 14-day trial, no card.

**What billing would need:**
- Stripe Billing with a `stripe_customer_id` / `stripe_subscription_id` on
  `tenants`, and `plan` + `seat_count` mirrored locally so the app never has to
  call Stripe on a request path.
- Stripe Checkout for signup, Customer Portal for card and plan changes — avoids
  handling card data at all (and keeps us out of the prohibited territory of
  entering card details ourselves).
- Webhooks for `customer.subscription.updated|deleted` and
  `invoice.payment_failed` → flip `tenants.status` to `past_due` / `cancelled`.
- A middleware gate: `past_due` gets a banner and a grace window; `cancelled`
  gets read-only access plus data export for 30 days, then deletion.
- Seat enforcement at invite time, metered against `users` where `is_active`.
- Sales tax on the *subscription* (not the shop's own tax rates) via Stripe Tax.

**Go-to-market, one paragraph.** The buyer is the owner, who is also a
technician and has no patience for a 6-week onboarding. The differentiators that
matter to them: data import from whatever they're on now, a real parts counter
(most competitors treat parts as an afterthought on the service side), and
transparent pricing without a mandatory annual contract or a per-RO fee. First
ten shops should be hand-onboarded, locally, in person.

---

## 9. Decisions taken

| | |
|---|---|
| **Name** | **Grip**. Domain not yet checked. |
| **Database** | Supabase-hosted Postgres 17, new project, $0/month |
| **Tax** | Ontario only: HST (rate editable, ships at 13%) or Exempt, selectable per document, auto-calculated (§4) |
| **Exemptions** | Carry a reason and, where one exists, a number; no exempt invoice can be issued without one (§4) |
| **Labour** | Shop chooses flat rate or straight time, overridable per work order and per line (§4) |
| **Multi-location** | One shop per tenant for v1; schema leaves room |
| **Shop settings** | Live under their own top-level **My Shop**, not inside Administration: the premises and the people are different jobs (§1) |
| **Customer page** | One vehicle's history at a time, chosen by `?vehicle=`, so a fleet account is a short list and only that vehicle's history is queried (§4) |

Settled since: Grip is Ontario-only for now, so HST is built in rather than
shipped as one preset among many. Selling outside Ontario means bringing the
rate builder back — the storage still supports it.

Still open: whether invoices need a customer-facing PDF in MVP, or printing
from the browser is enough.
