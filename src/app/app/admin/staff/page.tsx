import Link from "next/link";
import { ClickRow } from "@/components/ClickRow";
import { requireDepartment } from "@/lib/auth";
import { listRemovedStaff, listStaff } from "@/lib/admin-queries";
import { ROLE_LABELS } from "@/lib/permissions";
import { dateTime, money } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { RolesMenu } from "@/components/RolesMenu";
import { btn, card, input, label } from "@/components/ui";
import { createStaff, removeStaff } from "../actions";

export const dynamic = "force-dynamic";

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ removed?: string; shifts?: string; bookings?: string }>;
}) {
  const session = await requireDepartment("admin");
  const sp = await searchParams;
  const [staff, removed] = await Promise.all([listStaff(session), listRemovedStaff(session)]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Staff</h1>

      {sp.removed && (
        <p role="status" className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <strong>{sp.removed}</strong> has been removed. Their login is closed and their record is kept below.
          {Number(sp.shifts) > 0 && ` ${sp.shifts} upcoming shift${sp.shifts === "1" ? " was" : "s were"} cleared.`}
          {Number(sp.bookings) > 0 &&
            ` ${sp.bookings} upcoming booking${sp.bookings === "1" ? " was" : "s were"} left without a technician — assign ${sp.bookings === "1" ? "it" : "them"} on the schedule.`}
        </p>
      )}

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-steel">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">Sign-in</th>
              <th className="px-3 py-3 text-right">Pay / hr</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.map((s) => (
              <ClickRow key={s.id} href={`/app/admin/staff/${s.id}`} className={s.is_active ? "" : "opacity-55"}>
                <td className="px-4 py-3">
                  <Link href={`/app/admin/staff/${s.id}`} className="font-medium hover:underline">{s.full_name}</Link>
                  <div className="text-xs text-steel">{s.job_title}</div>
                </td>
                <td className="px-4 py-3 text-steel">
                  {s.user_id && s.role ? (
                    <RolesMenu
                      employeeId={s.id}
                      userId={s.user_id}
                      role={s.role}
                      extraRoles={s.extra_roles}
                      isActive={s.login_active ?? true}
                      isShopOwner={s.is_shop_owner}
                    />
                  ) : (
                    "—"
                  )}
                  {s.is_technician && <span className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700">technician</span>}
                </td>
                <td className="px-4 py-3 text-steel">
                  {s.email ? (
                    <>
                      {s.email}
                      {s.login_active === false && <span className="ml-2 text-xs text-red-700">disabled</span>}
                    </>
                  ) : (
                    <span className="text-xs">no login</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{money(s.hourly_rate)}</td>
                <td className="px-4 py-3 text-xs">
                  {!s.is_active ? <span className="text-steel">inactive</span>
                    : s.on_clock ? <span className="font-medium text-emerald-700">on the clock</span>
                    : <span className="text-steel">off</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {s.user_id !== session.userId && !s.is_shop_owner && (
                    <ActionForm action={removeStaff} className="inline-block">
                      <input type="hidden" name="id" value={s.id} />
                      <ConfirmButton
                        label="Remove"
                        title="Are you sure?"
                        confirmLabel="Yes, remove"
                        noteField={{ name: "note", label: "Reason (optional, kept on their record)", placeholder: "e.g. Left the shop" }}
                        message={
                          <>
                            <p>
                              <strong className="text-ink">{s.full_name}</strong> will be removed from staff.
                              {s.email && " Their login is closed for good and the email address is freed up."}
                            </p>
                            <ul className="mt-2 list-disc space-y-1 pl-5">
                              <li>Their record stays on file: pay, hours worked and everything they did.</li>
                              <li>Their upcoming shifts are cleared{s.on_clock ? " and they are clocked out now" : ""}.</li>
                              <li>Upcoming bookings assigned to them are left unassigned.</li>
                            </ul>
                            <p className="mt-2">This can&apos;t be undone.</p>
                          </>
                        }
                      />
                    </ActionForm>
                  )}
                </td>
              </ClickRow>
            ))}
          </tbody>
        </table>
      </div>

      {removed.length > 0 && (
        <section className={`${card} overflow-x-auto`}>
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">
            Removed staff <span className="text-sm font-normal text-steel">({removed.length}) — kept on file</span>
          </h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-steel">
              <tr>
                <th className="px-5 py-2">Name</th>
                <th className="px-3 py-2">Was</th>
                <th className="px-3 py-2 text-right">Hours on record</th>
                <th className="px-3 py-2">Removed</th>
                <th className="px-5 py-2">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {removed.map((r) => (
                <ClickRow key={r.id} href={`/app/admin/staff/${r.id}`}>
                  <td className="px-5 py-3">
                    <Link href={`/app/admin/staff/${r.id}`} className="font-medium hover:underline">{r.full_name}</Link>
                  </td>
                  <td className="px-3 py-3 text-steel">
                    {[r.job_title, r.role && ROLE_LABELS[r.role]].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.hours}</td>
                  <td className="px-3 py-3 text-steel">
                    {dateTime(r.removed_at)}
                    {r.removed_by_name && <div className="text-xs">by {r.removed_by_name}</div>}
                  </td>
                  <td className="px-5 py-3 text-steel">{r.removal_note ?? "—"}</td>
                </ClickRow>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <details className={`${card} p-5`}>
        <summary className="cursor-pointer text-sm font-semibold">Add a staff member</summary>
        <ActionForm action={createStaff} className="mt-4 space-y-5" keepAfterSuccess>
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <label className={label} htmlFor="n-name">Full name</label>
              <input id="n-name" name="full_name" required className={`${input} w-full`} />
            </div>
            <div className="sm:col-span-3">
              <label className={label} htmlFor="n-title">Job title</label>
              <input id="n-title" name="job_title" className={`${input} w-full`} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="n-rate">Pay per hour</label>
              <input id="n-rate" name="hourly_rate" inputMode="decimal" defaultValue="0" required className={`${input} w-full`} />
            </div>
            <div className="sm:col-span-2">
              <label className={label} htmlFor="n-type">Employment</label>
              <select id="n-type" name="employment_type" className={`${input} w-full`}>
                <option value="full_time">Full time</option>
                <option value="part_time">Part time</option>
                <option value="contractor">Contractor</option>
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2">
              <input type="checkbox" name="is_technician" /> Technician (bills labour)
            </label>
          </div>

          <fieldset className="rounded-lg border border-slate-200 p-4">
            <legend className="px-1 text-xs font-medium text-steel">Sign-in (optional)</legend>
            <p className="mb-3 text-xs text-steel">
              Leave the email blank for someone who doesn&apos;t need to use Grip. Their hours can still be tracked.
            </p>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-3">
                <label className={label} htmlFor="n-email">Email</label>
                <input id="n-email" name="email" type="email" autoComplete="off" className={`${input} w-full`} />
              </div>
              <div className="sm:col-span-3">
                <label className={label} htmlFor="n-role">Role</label>
                <select id="n-role" name="role" defaultValue="service_advisor" className={`${input} w-full`}>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="sm:col-span-6">
                <label className={label} htmlFor="n-pw">Temporary password</label>
                <input id="n-pw" name="password" type="text" autoComplete="off" placeholder="At least 8 characters" className={`${input} w-full sm:w-72`} />
                <p className="mt-1 text-xs text-steel">Tell them this, then ask them to change it from the menu once they&apos;re in.</p>
              </div>
            </div>
          </fieldset>

          <button className={btn}>Add staff member</button>
        </ActionForm>
      </details>
    </div>
  );
}
