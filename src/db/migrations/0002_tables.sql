-- Grip — 0002 — tables.
--
-- Conventions:
--   * every tenant-owned table carries `tenant_id uuid NOT NULL` and is
--     referenced by RLS policies in 0003;
--   * money is numeric(12,2), never float;
--   * tax rates are integer basis points (1250 = 12.50%), never float;
--   * natural keys are unique *per tenant*, never globally.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE grip.user_role AS ENUM (
  'service_advisor', 'technician', 'parts_advisor', 'shop_admin'
);

CREATE TYPE grip.tenant_status AS ENUM (
  'trialing', 'active', 'past_due', 'cancelled'
);

CREATE TYPE grip.labour_billing_mode AS ENUM ('flat_rate', 'straight_time');

CREATE TYPE grip.appointment_status AS ENUM (
  'scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'no_show', 'cancelled'
);

CREATE TYPE grip.work_order_status AS ENUM (
  'quote', 'approved', 'in_progress', 'completed', 'invoiced', 'paid', 'cancelled'
);

CREATE TYPE grip.purchase_order_status AS ENUM (
  'draft', 'ordered', 'partial', 'received', 'cancelled'
);

-- The stock ledger's vocabulary. `reserve`/`release` move qty_reserved;
-- `receive`/`consume`/`sale`/`adjust` move qty_on_hand.
CREATE TYPE grip.movement_kind AS ENUM (
  'receive', 'reserve', 'release', 'consume', 'adjust', 'sale', 'return'
);

-- ---------------------------------------------------------------------------
-- Identity and tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE grip.tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  plan          text NOT NULL DEFAULT 'shop',
  status        grip.tenant_status NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE grip.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  role          grip.user_role NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Per tenant, not global: the same person may work at two shops.
CREATE UNIQUE INDEX users_tenant_email_key ON grip.users (tenant_id, lower(email));
CREATE INDEX users_tenant_idx ON grip.users (tenant_id);

-- The SaaS operator. A row here is deliberately rare and fully audited.
CREATE TABLE grip.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES grip.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  note       text
);

CREATE TABLE grip.sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES grip.users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON grip.sessions (user_id);

-- ---------------------------------------------------------------------------
-- Tax — shop-defined rates, selectable per document
-- ---------------------------------------------------------------------------

CREATE TABLE grip.tax_rates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  name               text NOT NULL,
  applies_to_labour  boolean NOT NULL DEFAULT true,
  applies_to_parts   boolean NOT NULL DEFAULT true,
  is_default         boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tax_rates_tenant_name_key ON grip.tax_rates (tenant_id, lower(name));
-- At most one default per shop.
CREATE UNIQUE INDEX tax_rates_one_default_per_tenant
  ON grip.tax_rates (tenant_id) WHERE is_default;

-- A rate is a set of components so GST and PST print as separate invoice
-- lines rather than one blended number.
CREATE TABLE grip.tax_rate_components (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  tax_rate_id uuid NOT NULL REFERENCES grip.tax_rates(id) ON DELETE CASCADE,
  name        text NOT NULL,
  rate_bps    integer NOT NULL CHECK (rate_bps >= 0 AND rate_bps <= 100000),
  sort_order  integer NOT NULL DEFAULT 0
);
CREATE INDEX tax_rate_components_rate_idx ON grip.tax_rate_components (tax_rate_id);

CREATE TABLE grip.tenant_settings (
  tenant_id            uuid PRIMARY KEY REFERENCES grip.tenants(id) ON DELETE CASCADE,
  legal_name           text,
  address_line1        text,
  address_line2        text,
  city                 text,
  region               text,
  postal_code          text,
  country              text NOT NULL DEFAULT 'CA',
  phone                text,
  email                text,
  logo_url             text,
  invoice_footer       text,
  default_labour_rate  numeric(12,2) NOT NULL DEFAULT 120.00,
  labour_billing_mode  grip.labour_billing_mode NOT NULL DEFAULT 'flat_rate',
  default_tax_rate_id  uuid REFERENCES grip.tax_rates(id) ON DELETE SET NULL,
  shop_supplies_pct    numeric(5,2) NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Administration — staff
-- ---------------------------------------------------------------------------

CREATE TABLE grip.employees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  -- Nullable: a tech who never touches the software still needs hours tracked.
  user_id         uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  full_name       text NOT NULL,
  job_title       text,
  hourly_rate     numeric(12,2) NOT NULL DEFAULT 0,
  billable_rate   numeric(12,2),
  employment_type text NOT NULL DEFAULT 'full_time',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employees_tenant_idx ON grip.employees (tenant_id);

CREATE TABLE grip.shifts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES grip.employees(id) ON DELETE CASCADE,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX shifts_tenant_start_idx ON grip.shifts (tenant_id, starts_at);

CREATE TABLE grip.time_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES grip.employees(id) ON DELETE CASCADE,
  work_order_id uuid,
  clock_in      timestamptz NOT NULL,
  clock_out     timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (clock_out IS NULL OR clock_out > clock_in)
);
CREATE INDEX time_entries_tenant_employee_idx ON grip.time_entries (tenant_id, employee_id);

-- ---------------------------------------------------------------------------
-- Service — customers, vehicles, scheduling
-- ---------------------------------------------------------------------------

CREATE TABLE grip.customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  first_name    text,
  last_name     text,
  company       text,
  phone         text,
  email         text,
  address_line1 text,
  city          text,
  region        text,
  postal_code   text,
  -- Fleet and wholesale accounts are often tax-exempt.
  tax_rate_id   uuid REFERENCES grip.tax_rates(id) ON DELETE SET NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_tenant_name_idx ON grip.customers (tenant_id, display_name);

CREATE TABLE grip.vehicles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  customer_id     uuid NOT NULL REFERENCES grip.customers(id) ON DELETE CASCADE,
  vin             text,
  year            integer,
  make            text,
  model           text,
  trim            text,
  engine          text,
  plate           text,
  colour          text,
  current_mileage integer,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_tenant_customer_idx ON grip.vehicles (tenant_id, customer_id);
-- A VIN is unique within a shop, but two shops may both service the same truck.
CREATE UNIQUE INDEX vehicles_tenant_vin_key
  ON grip.vehicles (tenant_id, upper(vin)) WHERE vin IS NOT NULL;

CREATE TABLE grip.bays (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX bays_tenant_name_key ON grip.bays (tenant_id, lower(name));

CREATE TABLE grip.appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  customer_id       uuid NOT NULL REFERENCES grip.customers(id) ON DELETE CASCADE,
  vehicle_id        uuid NOT NULL REFERENCES grip.vehicles(id) ON DELETE CASCADE,
  bay_id            uuid REFERENCES grip.bays(id) ON DELETE SET NULL,
  assigned_tech_id  uuid REFERENCES grip.employees(id) ON DELETE SET NULL,
  starts_at         timestamptz NOT NULL,
  estimated_minutes integer NOT NULL DEFAULT 60 CHECK (estimated_minutes > 0),
  status            grip.appointment_status NOT NULL DEFAULT 'scheduled',
  concern           text,
  created_by        uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointments_tenant_start_idx ON grip.appointments (tenant_id, starts_at);

-- ---------------------------------------------------------------------------
-- Parts — suppliers, catalogue, stock
-- ---------------------------------------------------------------------------

CREATE TABLE grip.suppliers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  account_no   text,
  phone        text,
  email        text,
  lead_time_days integer NOT NULL DEFAULT 2,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_tenant_name_key ON grip.suppliers (tenant_id, lower(name));

CREATE TABLE grip.parts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  sku           text NOT NULL,
  description   text NOT NULL,
  category      text,
  bin_location  text,
  unit_cost     numeric(12,2) NOT NULL DEFAULT 0,
  unit_price    numeric(12,2) NOT NULL DEFAULT 0,
  reorder_point integer NOT NULL DEFAULT 0,
  reorder_qty   integer NOT NULL DEFAULT 0,
  supplier_id   uuid REFERENCES grip.suppliers(id) ON DELETE SET NULL,
  is_stocked    boolean NOT NULL DEFAULT true,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX parts_tenant_sku_key ON grip.parts (tenant_id, upper(sku));
CREATE INDEX parts_tenant_desc_idx ON grip.parts (tenant_id, description);

-- Split from `parts` so a reservation locks a narrow, hot row rather than the
-- whole catalogue record (which an advisor may be editing at the same time).
CREATE TABLE grip.part_stock (
  part_id      uuid PRIMARY KEY REFERENCES grip.parts(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  qty_on_hand  integer NOT NULL DEFAULT 0,
  qty_reserved integer NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_on_order integer NOT NULL DEFAULT 0 CHECK (qty_on_order >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX part_stock_tenant_idx ON grip.part_stock (tenant_id);

-- Append-only. This is the audit trail for stock, and the thing on-hand and
-- reserved are reconciled against. Nothing here is ever updated or deleted.
CREATE TABLE grip.stock_movements (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  part_id    uuid NOT NULL REFERENCES grip.parts(id) ON DELETE CASCADE,
  kind       grip.movement_kind NOT NULL,
  -- Signed. Which counter it moves depends on `kind`: reserve/release move
  -- qty_reserved, the rest move qty_on_hand.
  delta      integer NOT NULL,
  ref_type   text,
  ref_id     uuid,
  user_id    uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_tenant_part_idx ON grip.stock_movements (tenant_id, part_id, id);
CREATE INDEX stock_movements_ref_idx ON grip.stock_movements (ref_type, ref_id);

CREATE TABLE grip.purchase_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  number       integer NOT NULL,
  supplier_id  uuid NOT NULL REFERENCES grip.suppliers(id) ON DELETE RESTRICT,
  status       grip.purchase_order_status NOT NULL DEFAULT 'draft',
  tax_rate_id  uuid REFERENCES grip.tax_rates(id) ON DELETE SET NULL,
  expected_at  date,
  subtotal     numeric(12,2) NOT NULL DEFAULT 0,
  tax_total    numeric(12,2) NOT NULL DEFAULT 0,
  total        numeric(12,2) NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchase_orders_tenant_number_key ON grip.purchase_orders (tenant_id, number);

CREATE TABLE grip.purchase_order_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES grip.purchase_orders(id) ON DELETE CASCADE,
  part_id           uuid NOT NULL REFERENCES grip.parts(id) ON DELETE RESTRICT,
  qty_ordered       integer NOT NULL CHECK (qty_ordered > 0),
  qty_received      integer NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost         numeric(12,2) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_order_lines_po_idx ON grip.purchase_order_lines (purchase_order_id);

CREATE TABLE grip.stock_adjustments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  part_id    uuid NOT NULL REFERENCES grip.parts(id) ON DELETE CASCADE,
  delta      integer NOT NULL,
  reason     text NOT NULL,
  user_id    uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_adjustments_tenant_part_idx ON grip.stock_adjustments (tenant_id, part_id);

-- ---------------------------------------------------------------------------
-- The work order spine
-- ---------------------------------------------------------------------------

CREATE TABLE grip.work_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  number              integer NOT NULL,
  customer_id         uuid NOT NULL REFERENCES grip.customers(id) ON DELETE RESTRICT,
  vehicle_id          uuid NOT NULL REFERENCES grip.vehicles(id) ON DELETE RESTRICT,
  appointment_id      uuid REFERENCES grip.appointments(id) ON DELETE SET NULL,
  status              grip.work_order_status NOT NULL DEFAULT 'quote',
  concern             text,
  mileage_in          integer,
  mileage_out         integer,
  service_advisor_id  uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  opened_by           uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  -- Chosen per document, defaulted from tenant_settings, changeable by whoever
  -- is writing it up.
  tax_rate_id         uuid REFERENCES grip.tax_rates(id) ON DELETE SET NULL,
  labour_billing_mode grip.labour_billing_mode NOT NULL DEFAULT 'flat_rate',
  labour_subtotal     numeric(12,2) NOT NULL DEFAULT 0,
  parts_subtotal      numeric(12,2) NOT NULL DEFAULT 0,
  subtotal            numeric(12,2) NOT NULL DEFAULT 0,
  tax_total           numeric(12,2) NOT NULL DEFAULT 0,
  total               numeric(12,2) NOT NULL DEFAULT 0,
  approved_at         timestamptz,
  completed_at        timestamptz,
  invoiced_at         timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX work_orders_tenant_number_key ON grip.work_orders (tenant_id, number);
CREATE INDEX work_orders_tenant_status_idx ON grip.work_orders (tenant_id, status);
CREATE INDEX work_orders_tenant_vehicle_idx ON grip.work_orders (tenant_id, vehicle_id);

ALTER TABLE grip.time_entries
  ADD CONSTRAINT time_entries_work_order_fkey
  FOREIGN KEY (work_order_id) REFERENCES grip.work_orders(id) ON DELETE SET NULL;

CREATE TABLE grip.work_order_labour_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  work_order_id   uuid NOT NULL REFERENCES grip.work_orders(id) ON DELETE CASCADE,
  description     text NOT NULL,
  -- What the customer pays for. In straight_time this mirrors actual_hours.
  billed_hours    numeric(6,2) NOT NULL DEFAULT 0 CHECK (billed_hours >= 0),
  -- What the tech actually took. Kept in both modes so technician efficiency
  -- (billed ÷ actual) works the same either way.
  actual_hours    numeric(6,2) NOT NULL DEFAULT 0 CHECK (actual_hours >= 0),
  rate            numeric(12,2) NOT NULL DEFAULT 0,
  billing_mode    grip.labour_billing_mode NOT NULL DEFAULT 'flat_rate',
  tech_id         uuid REFERENCES grip.employees(id) ON DELETE SET NULL,
  is_taxable      boolean NOT NULL DEFAULT true,
  -- The audit trail the brief asks for: who put this on the order.
  added_by_user_id uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wo_labour_lines_wo_idx ON grip.work_order_labour_lines (work_order_id);

CREATE TABLE grip.work_order_part_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  work_order_id    uuid NOT NULL REFERENCES grip.work_orders(id) ON DELETE CASCADE,
  part_id          uuid NOT NULL REFERENCES grip.parts(id) ON DELETE RESTRICT,
  description      text NOT NULL,
  qty              integer NOT NULL CHECK (qty > 0),
  -- Snapshotted at the time the line was added: the catalogue price may move,
  -- the quote the customer agreed to may not.
  unit_cost        numeric(12,2) NOT NULL DEFAULT 0,
  unit_price       numeric(12,2) NOT NULL DEFAULT 0,
  qty_reserved     integer NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0),
  qty_consumed     integer NOT NULL DEFAULT 0 CHECK (qty_consumed >= 0),
  -- Set when stock could not cover the line and backorder was allowed.
  qty_backordered  integer NOT NULL DEFAULT 0 CHECK (qty_backordered >= 0),
  is_taxable       boolean NOT NULL DEFAULT true,
  added_by_user_id uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wo_part_lines_wo_idx ON grip.work_order_part_lines (work_order_id);
CREATE INDEX wo_part_lines_part_idx ON grip.work_order_part_lines (tenant_id, part_id);

-- Tax as charged, per component, stored on the document. A reprint of a
-- two-year-old invoice shows the tax actually charged, not today's rate.
CREATE TABLE grip.work_order_taxes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES grip.work_orders(id) ON DELETE CASCADE,
  component_name text NOT NULL,
  rate_bps      integer NOT NULL,
  taxable_base  numeric(12,2) NOT NULL DEFAULT 0,
  amount        numeric(12,2) NOT NULL DEFAULT 0,
  sort_order    integer NOT NULL DEFAULT 0
);
CREATE INDEX wo_taxes_wo_idx ON grip.work_order_taxes (work_order_id);

-- ---------------------------------------------------------------------------
-- Parts counter sales — no work order involved
-- ---------------------------------------------------------------------------

CREATE TABLE grip.counter_sales (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  number      integer NOT NULL,
  customer_id uuid REFERENCES grip.customers(id) ON DELETE SET NULL,
  customer_name text,
  status      text NOT NULL DEFAULT 'open',
  tax_rate_id uuid REFERENCES grip.tax_rates(id) ON DELETE SET NULL,
  subtotal    numeric(12,2) NOT NULL DEFAULT 0,
  tax_total   numeric(12,2) NOT NULL DEFAULT 0,
  total       numeric(12,2) NOT NULL DEFAULT 0,
  sold_by     uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX counter_sales_tenant_number_key ON grip.counter_sales (tenant_id, number);

CREATE TABLE grip.counter_sale_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  counter_sale_id uuid NOT NULL REFERENCES grip.counter_sales(id) ON DELETE CASCADE,
  part_id         uuid NOT NULL REFERENCES grip.parts(id) ON DELETE RESTRICT,
  description     text NOT NULL,
  qty             integer NOT NULL CHECK (qty > 0),
  unit_cost       numeric(12,2) NOT NULL DEFAULT 0,
  unit_price      numeric(12,2) NOT NULL DEFAULT 0,
  is_taxable      boolean NOT NULL DEFAULT true,
  added_by_user_id uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX counter_sale_lines_sale_idx ON grip.counter_sale_lines (counter_sale_id);

CREATE TABLE grip.counter_sale_taxes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  counter_sale_id uuid NOT NULL REFERENCES grip.counter_sales(id) ON DELETE CASCADE,
  component_name  text NOT NULL,
  rate_bps        integer NOT NULL,
  taxable_base    numeric(12,2) NOT NULL DEFAULT 0,
  amount          numeric(12,2) NOT NULL DEFAULT 0,
  sort_order      integer NOT NULL DEFAULT 0
);
CREATE INDEX counter_sale_taxes_sale_idx ON grip.counter_sale_taxes (counter_sale_id);

-- ---------------------------------------------------------------------------
-- Document numbering — per tenant, gapless-enough, no cross-tenant leakage
-- ---------------------------------------------------------------------------

CREATE TABLE grip.document_counters (
  tenant_id uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  kind      text NOT NULL,
  next_value integer NOT NULL DEFAULT 1001,
  PRIMARY KEY (tenant_id, kind)
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

CREATE TABLE grip.audit_log (
  id             bigserial PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES grip.tenants(id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES grip.users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  entity         text NOT NULL,
  entity_id      uuid,
  diff           jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_created_idx ON grip.audit_log (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants','users','tax_rates','employees','customers','vehicles',
    'appointments','suppliers','parts','purchase_orders','work_orders',
    'work_order_labour_lines','work_order_part_lines','counter_sales'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_touch_updated_at BEFORE UPDATE ON grip.%I
         FOR EACH ROW EXECUTE FUNCTION grip.touch_updated_at()', t, t);
  END LOOP;
END $$;
