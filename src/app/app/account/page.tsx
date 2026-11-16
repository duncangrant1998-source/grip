import { requireSession } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";
import { ActionForm } from "@/components/ActionForm";
import { btn, card, input, label } from "@/components/ui";
import { changePassword } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="text-sm text-steel">
          {session.fullName} · {session.isPlatformAdmin ? "Platform operator" : ROLE_LABELS[session.role]}
        </p>
      </div>

      <section className={`${card} p-5`}>
        <h2 className="mb-3 font-semibold">Change password</h2>
        <ActionForm action={changePassword} className="space-y-3">
          <div>
            <label className={label} htmlFor="cur">Current password</label>
            <input id="cur" name="current" type="password" autoComplete="current-password" required className={`${input} w-full`} />
          </div>
          <div>
            <label className={label} htmlFor="new">New password</label>
            <input id="new" name="next" type="password" autoComplete="new-password" required minLength={8} className={`${input} w-full`} />
          </div>
          <div>
            <label className={label} htmlFor="conf">Confirm new password</label>
            <input id="conf" name="confirm" type="password" autoComplete="new-password" required minLength={8} className={`${input} w-full`} />
          </div>
          <button className={btn}>Change password</button>
          <p className="text-xs text-steel">You&apos;ll be signed out everywhere and asked to sign in again.</p>
        </ActionForm>
      </section>
    </div>
  );
}
