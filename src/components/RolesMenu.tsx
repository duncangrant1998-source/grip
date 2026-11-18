import { ActionForm } from "@/components/ActionForm";
import { ALL_ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";
import { updateAccess } from "@/app/app/admin/actions";

/**
 * The role picker: a dropdown beside a staff member's name (or inline on
 * their own page) where an admin ticks any combination of the four roles.
 * Ticking adds access, unticking removes it — `updateAccess` does the rest.
 *
 * The shop's one owner never gets this control: their access can't be
 * changed from here by anyone, including themselves.
 */
export function RolesMenu({
  employeeId,
  userId,
  role,
  extraRoles,
  isActive,
  isShopOwner,
}: {
  employeeId: string;
  userId: string;
  role: Role;
  extraRoles: readonly Role[];
  isActive: boolean;
  isShopOwner: boolean;
}) {
  if (isShopOwner) {
    return (
      <span className="rounded bg-slate-100 px-2 py-1.5 text-xs font-medium text-steel">
        Owner · full access
      </span>
    );
  }

  const checked = new Set<Role>([role, ...extraRoles]);

  return (
    <details className="relative inline-block text-left">
      <summary className="no-marker flex w-fit cursor-pointer select-none items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50">
        Roles <span aria-hidden>▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <ActionForm action={updateAccess} className="space-y-2" keepAfterSuccess>
          <input type="hidden" name="employee_id" value={employeeId} />
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="is_active" value={isActive ? "on" : ""} />
          <p className="text-[11px] text-steel">Tick every role this person should have.</p>
          <div className="space-y-1.5">
            {ALL_ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="roles" value={r} defaultChecked={checked.has(r)} />
                {ROLE_LABELS[r]}
              </label>
            ))}
          </div>
          <button className="w-full rounded-md bg-ink px-2 py-1.5 text-xs font-semibold text-white hover:bg-black">
            Save
          </button>
        </ActionForm>
      </div>
    </details>
  );
}
