"use client";

import { useState } from "react";
import type { InvoiceLogoPosition, InvoiceTemplate } from "@/lib/admin-queries";

const TEMPLATES: { value: InvoiceTemplate; label: string; blurb: string }[] = [
  { value: "classic", label: "Classic", blurb: "Plain, businesslike — the Grip default." },
  { value: "modern", label: "Modern", blurb: "Bolder header with a colour accent." },
  { value: "minimal", label: "Minimal", blurb: "Centred, understated, lots of whitespace." },
];

const POSITIONS: { value: InvoiceLogoPosition; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];

/**
 * Picks the print layout (classic/modern/minimal) and where the logo sits
 * within it. Native radios, so values ride along with the rest of the
 * surrounding ActionForm — this component is just the live-highlighted UI
 * on top of them. A per-template mini mock-up shows roughly what the real
 * quote/invoice print will look like before saving.
 */
export function TemplatePicker({
  defaultTemplate,
  defaultLogoPosition,
}: {
  defaultTemplate: InvoiceTemplate;
  defaultLogoPosition: InvoiceLogoPosition;
}) {
  const [template, setTemplate] = useState<InvoiceTemplate>(defaultTemplate);
  const [logoPos, setLogoPos] = useState<InvoiceLogoPosition>(defaultLogoPosition);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <label
            key={t.value}
            className={`cursor-pointer rounded-lg border p-2.5 transition ${
              template === t.value ? "border-shop ring-2 ring-shop/20" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <input
              type="radio"
              name="invoice_template"
              value={t.value}
              checked={template === t.value}
              onChange={() => setTemplate(t.value)}
              className="sr-only"
            />
            <MockDoc template={t.value} logoPos={logoPos} />
            <div className="mt-2 text-sm font-semibold">{t.label}</div>
            <div className="text-xs text-steel">{t.blurb}</div>
          </label>
        ))}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-steel">Logo position</div>
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
          {POSITIONS.map((p) => (
            <label
              key={p.value}
              className={`cursor-pointer rounded px-3 py-1 text-xs font-medium transition ${
                logoPos === p.value ? "bg-ink text-white" : "text-steel hover:text-ink"
              }`}
            >
              <input
                type="radio"
                name="invoice_logo_position"
                value={p.value}
                checked={logoPos === p.value}
                onChange={() => setLogoPos(p.value)}
                className="sr-only"
              />
              {p.label}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-steel">Applies within whichever layout is selected above.</p>
      </div>
    </div>
  );
}

function MockDoc({ template, logoPos }: { template: InvoiceTemplate; logoPos: InvoiceLogoPosition }) {
  const justify = logoPos === "left" ? "justify-start" : logoPos === "right" ? "justify-end" : "justify-center";
  const logo = <div className="h-3 w-6 rounded-sm bg-slate-300" />;

  if (template === "modern") {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded border border-slate-200 bg-white p-2">
        <div className="-m-2 mb-2 bg-shop/90 p-2">
          <div className={`flex ${justify}`}>
            <div className="h-3 w-6 rounded-sm bg-white/80" />
          </div>
        </div>
        <div className="space-y-1">
          <div className="h-1 w-3/4 rounded bg-slate-200" />
          <div className="h-1 w-1/2 rounded bg-slate-200" />
          <div className="mt-2 h-1 w-full rounded bg-slate-100" />
          <div className="h-1 w-full rounded bg-slate-100" />
          <div className="ml-auto h-1.5 w-1/3 rounded bg-shop/40" />
        </div>
      </div>
    );
  }

  if (template === "minimal") {
    return (
      <div className="aspect-[4/3] w-full overflow-hidden rounded border border-slate-200 bg-white p-2.5">
        <div className={`flex ${justify}`}>{logo}</div>
        <div className="mt-2 flex flex-col items-center space-y-1">
          <div className="h-1 w-1/2 rounded bg-slate-200" />
          <div className="h-1 w-1/3 rounded bg-slate-100" />
        </div>
        <div className="mt-3 h-px w-full bg-slate-100" />
        <div className="mt-2 space-y-1">
          <div className="h-1 w-full rounded bg-slate-100" />
          <div className="h-1 w-full rounded bg-slate-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="aspect-[4/3] w-full overflow-hidden rounded border border-slate-200 bg-white p-2.5">
      <div className="flex items-start justify-between">
        <div className={logoPos === "left" ? "" : "order-2"}>{logo}</div>
        <div className="space-y-1 text-right">
          <div className="h-1.5 w-10 rounded bg-slate-300" />
          <div className="h-1 w-6 rounded bg-slate-100" />
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <div className="h-1 w-3/4 rounded bg-slate-100" />
        <div className="h-1 w-1/2 rounded bg-slate-100" />
      </div>
      <div className="ml-auto mt-3 h-1.5 w-1/3 rounded bg-slate-200" />
    </div>
  );
}
