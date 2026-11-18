-- Grip — 0025 — invoice/quote layout choice.
--
-- Shops differ on how they want their customer-facing documents to look.
-- Rather than one fixed, non-negotiable layout, a shop picks one of three
-- built-in styles — Classic, Modern, Minimal — from My Shop > Details, and
-- can still nudge where the logo sits within whichever style it picked.
-- The footer field (0002) already doubles as a free-text notes area and
-- applies under any of the three, so it isn't duplicated here. Both choices
-- are stored once per tenant and applied to every quote/invoice print
-- (orders/[id]/print), same as the logo and footer already are.

CREATE TYPE grip.invoice_template AS ENUM ('classic', 'modern', 'minimal');
CREATE TYPE grip.invoice_logo_position AS ENUM ('left', 'center', 'right');

ALTER TABLE grip.tenant_settings
  ADD COLUMN invoice_template grip.invoice_template NOT NULL DEFAULT 'classic',
  ADD COLUMN invoice_logo_position grip.invoice_logo_position NOT NULL DEFAULT 'left';
