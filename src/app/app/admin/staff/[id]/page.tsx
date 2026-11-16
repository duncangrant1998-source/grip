import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDepartment } from "@/lib/auth";
import { getStaff, staffRecord, unlinkedLogins } from "@/lib/admin-queries";
import { ROLE_LABELS } from "@/lib/permissions";
import { dateTime, money } from "@/lib/format";
import { formatShort } from "@/lib/dates";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { btn, btnGhost, card, input, label } from "@/components/ui";
import { addLogin, removeStaff, resetPassword, updateAccess, updateStaff } from "../../actions";

export const dynamic = "force-dynamic";

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireDepartment("admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const s = await getStaff(session, id);
  if (!s) notFound();

  // Someone who has been removed is a record, not a form: everything is shown, nothing can be edited.
  if (s.removed_at) {
    const rec = await staffRecord(session, s.id);
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <Link href="/app/admin/staff" className="text-sm text-steel hover:text-ink">← Staff</Link>
          <h1 className="mt-1 text-2xl font-bold">{s.full_name}</h1>
          <p className="text-sm text-steel">{s.job_title}</p>
        </div>

        <p className="rounded-md bg-slate-100 px-4 py-3 text-sm">
          <strong>Removed from staff</strong> on {dateTime(s.removed_at)}
          {s.removed_by_name && <> by {s.removed_by_name}</>}.
          {s.removal_note && <> &ldquo;{s.removal_note}&rdquo;</>}{" "}
          <span className="text-steel">Their login is closed. This record is kept for the history.</span>
        </p>

        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Hours on record", rec.total_hours],
            ["Days worked", String(rec.days)],
            ["Jobs worked on", String(rec.jobs)],
            ["On file since", s.created_at ? formatShort(new Date(s.created_at).toISOString().slice(0, 10)) : "—"],
          ].map(([k, v]) => (
            <div key={k} className={`${card} p-4`}>
              <div className="text-xs text-steel">{k}</div>
              <div className="text-2xl font-bold tabular-nums">{v}</div>
            </div>
          ))}
        </div>

        <section className={`${card} p-5`}>
          <h2 className="mb-3 font-semibold">Details</h2>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
            <dt className="text-steel">Job title</dt><dd>{s.job_title ?? "—"}</dd>
            <dt className="text-steel">Phone</dt><dd>{s.phone ?? "—"}</dd>
            <dt className="text-steel">Personal email</dt><dd>{s.personal_email ?? "—"}</dd>
            <dt className="text-steel">Address</dt><dd>{s.address ?? "—"}</dd>
            <dt className="text-steel">Employment</dt><dd className="capitalize">{s.employment_type.replace("_", " ")}</dd>
            <dt className="text-steel">Pay per hour</dt><dd>{money(s.hourly_rate)}</dd>
            <dt className="text-steel">Was a technician</dt><dd>{s.is_technician ? "Yes" : "No"}</dd>
            <dt className="text-steel">Role at Grip</dt><dd>{s.role ? ROLE_LABELS[s.role] : "No login"}</dd>
            <dt className="text-steel">First / last clocked</dt>
            <dd>{rec.first_day ? `${formatShort(rec.first_day)} – ${formatShort(rec.last_day!)}` : "Never clocked in"}</dd>
          </dl>
        </section>

        <section className={`${card} overflow-hidden`}>
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Time clock history</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {rec.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-5 py-2.5">
                <span>
                  <span className="font-medium">{formatShort(e.local_date)}</span>{" "}
                  <span className="text-steel">{e.in_time} – {e.out_time ?? "—"}</span>
                  <span className="text-steel"> · {e.work_order_number ? `#${e.work_order_number}` : "hourly"}</span>
                </span>
                <span className="tabular-nums text-steel">
                  {e.minutes != null ? `${(e.minutes / 60).toFixed(2)} h` : ""}
                </span>
              </li>
            ))}
            {rec.entries.length === 0 && <li className="px-5 py-6 text-center text-steel">No time was ever clocked.</li>}
          </ul>
        </section>
      </div>
    );
  }

  const candidates = s.user_id ? [] : await unlinkedLogins(session);
  const isMe = s.user_id === session.userId;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link href="/app/admin/staff" className="text-sm text-steel hover:text-ink">← Staff</Link>
        <h1 className="mt-1 text-2xl font-bold">{s.full_name}</h1>
        <p className="text-sm text-steel">{s.job_title}{!s.is_active && " · inactive"}</p>
      </div>

      <section className={`${card} p-5`}>
        <h2 className="mb-4 font-semibold">Details and pay</h2>
        <ActionForm action={updateStaff} className="grid gap-3 sm:grid-cols-6" keepAfterSuccess>
          <input type="hidden" name="id" value={s.id} />
          <div className="sm:col-span-3">
            <label className={label} htmlFor="name">Full name</label>
            <input id="name" name="full_name" required defaultValue={s.full_name} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-3">
            <label className={label} htmlFor="title">Job title</label>
            <input id="title" name="job_title" defaultValue={s.job_title ?? ""} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="phone">Phone</label>
            <input id="phone" name="phone" type="tel" defaultValue={s.phone ?? ""} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-4">
            <label className={label} htmlFor="pemail">Personal email</label>
            <input id="pemail" name="personal_email" type="email" defaultValue={s.personal_email ?? ""} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-6">
            <label className={label} htmlFor="addr">Address</label>
            <input id="addr" name="address" defaultValue={s.address ?? ""} placeholder="Street, city, province, postal code" className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="rate">Pay per hour</label>
            <input id="rate" name="hourly_rate" inputMode="decimal" defaultValue={s.hourly_rate} className={`${input} w-full`} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="type">Employment</label>
            <select id="type" name="employment_type" defaultValue={s.employment_type} className={`${input} w-full`}>
              <option value="full_time">Full time</option>
              <option value="part_time">Part time</option>
              <option value="contractor">Contractor</option>
            </select>
          </div>
          <div className="flex flex-col justify-end gap-2 pb-1 text-sm sm:col-span-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="is_technician" defaultChecked={s.is_technician} /> Technician</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="is_active" defaultChecked={s.is_active} /> Active</label>
          </div>
          <div className="sm:col-span-6"><button className={btn}>Save</button></div>
        </ActionForm>
        <p className="mt-3 text-xs text-steel">
          Pay rate is what this person costs per hour; it feeds the labour cost and margin reports. It is
          never shown to customers.
        </p>
      </section>

      <section className={`${card} p-5`}>
        <h2 className="mb-1 font-semibold">Sign-in</h2>
        {s.user_id ? (
          <>
            <p className="mb-4 text-sm text-steel">
              {s.email}
              {s.last_login_at ? ` · last signed in ${dateTime(s.last_login_at)}` : " · has not signed in yet"}
            </p>
            <ActionForm action={updateAccess} className="flex flex-wrap items-end gap-3" keepAfterSuccess>
              <input type="hidden" name="employee_id" value={s.id} />
              <input type="hidden" name="user_id" value={s.user_id} />
              <div>
                <label className={label} htmlFor="role">Role</label>
                <select id="role" name="role" defaultValue={s.role ?? "service_advisor"} className={input}>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="is_active" defaultChecked={s.login_active ?? true} /> Can sign in
              </label>
              <button className={btnGhost}>Update access</button>
            </ActionForm>
            {isMe && <p className="mt-2 text-xs text-steel">This is you. A shop must always keep at least one active administrator.</p>}

            <div className="mt-5 border-t border-slate-100 pt-4">
              <ActionForm action={resetPassword} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="employee_id" value={s.id} />
                <input type="hidden" name="user_id" value={s.user_id} />
                <div>
                  <label className={label} htmlFor="pw">New temporary password</label>
                  <input id="pw" name="password" type="text" autoComplete="off" placeholder="At least 8 characters" className={`${input} w-64`} />
                </div>
                <button className={btnGhost}>Reset password</button>
              </ActionForm>
              <p className="mt-2 text-xs text-steel">Resetting signs them out everywhere.</p>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-steel">No login. Their hours can be tracked, but they can&apos;t sign in.</p>
            <ActionForm action={addLogin} className="grid gap-3 sm:grid-cols-6" keepAfterSuccess>
              <input type="hidden" name="employee_id" value={s.id} />
              <input type="hidden" name="mode" value="new" />
              <div className="sm:col-span-3">
                <label className={label} htmlFor="l-email">Email</label>
                <input id="l-email" name="email" type="email" autoComplete="off" className={`${input} w-full`} />
              </div>
              <div className="sm:col-span-3">
                <label className={label} htmlFor="l-role">Role</label>
                <select id="l-role" name="role" defaultValue="service_advisor" className={`${input} w-full`}>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="sm:col-span-6">
                <label className={label} htmlFor="l-pw">Temporary password</label>
                <input id="l-pw" name="password" type="text" autoComplete="off" placeholder="At least 8 characters" className={`${input} w-full sm:w-72`} />
              </div>
              <div className="sm:col-span-6"><button className={btn}>Create login</button></div>
            </ActionForm>

            {candidates.length > 0 && (
              <ActionForm action={addLogin} className="mt-5 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                <input type="hidden" name="employee_id" value={s.id} />
                <input type="hidden" name="mode" value="link" />
                <div>
                  <label className={label} htmlFor="existing">Or link an existing login</label>
                  <select id="existing" name="existing_user_id" className={`${input} w-72`}>
                    <option value="">Choose…</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>{c.full_name} — {c.email}</option>
                    ))}
                  </select>
                </div>
                <button className={btnGhost}>Link</button>
              </ActionForm>
            )}
          </>
        )}
      </section>

      {/* Removing someone is final for the account, so it asks first. */}
      {!isMe && (
        <section className={`${card} border-red-200 p-5`}>
          <h2 className="mb-1 font-semibold text-red-800">Remove from staff</h2>
          <p className="mb-3 max-w-2xl text-sm text-steel">
            Closes their login for good and frees the email address. Their record — pay, hours worked
            and everything they did — stays on file and can still be viewed. Deactivating, above, is
            the reversible option if they might come back.
          </p>
          <ActionForm action={removeStaff}>
            <input type="hidden" name="id" value={s.id} />
            <ConfirmButton
              label="Remove from staff"
              confirmLabel="Yes, remove"
              noteField={{ name: "note", label: "Reason (optional, kept on their record)", placeholder: "e.g. Left the shop" }}
              message={
                <>
                  <p><strong className="text-ink">{s.full_name}</strong> will be removed from staff. This can&apos;t be undone.</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>Their login is closed and cannot be reopened.</li>
                    <li>Upcoming shifts are cleared; they are clocked out if on the clock.</li>
                    <li>Upcoming bookings assigned to them are left unassigned.</li>
                  </ul>
                </>
              }
            />
          </ActionForm>
        </section>
      )}
    </div>
  );
}
