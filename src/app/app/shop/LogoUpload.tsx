"use client";

import { ActionForm } from "@/components/ActionForm";
import { btnDanger, btnGhost } from "@/components/ui";
import { removeLogo, uploadLogo } from "./actions";

/**
 * Uploads the shop's actual logo file (stored as a data: URL — see
 * uploadLogo in ./actions.ts) rather than asking for a link to one hosted
 * elsewhere. Picking a file submits immediately; no separate "Save" step.
 */
export function LogoUpload({ logoUrl }: { logoUrl: string | null }) {
  return (
    <div className="space-y-2">
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="Logo preview" className="h-12 rounded border border-slate-200 bg-white p-1" />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ActionForm action={uploadLogo} keepAfterSuccess>
          <label htmlFor="logo_file" className={`${btnGhost} cursor-pointer`}>
            {logoUrl ? "Replace logo" : "Upload logo"}
          </label>
          <input
            id="logo_file"
            name="logo_file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="sr-only"
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          />
        </ActionForm>
        {logoUrl && (
          <ActionForm action={removeLogo}>
            <button className={btnDanger}>Remove</button>
          </ActionForm>
        )}
      </div>
      <p className="text-xs text-steel">PNG, JPEG, WebP or SVG, up to 1&nbsp;MB.</p>
    </div>
  );
}
