import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { ResetForm } from "./ResetForm";

export const metadata = { title: "Set a new password — Grip" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (await getSession()) redirect("/app");
  const { token } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center px-6 pb-16 pt-16 sm:pt-24">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo className="h-20 sm:h-24" />
        </div>
        <h1 className="mb-6 text-center text-2xl font-bold">Set a new password</h1>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {token ? (
            <ResetForm token={token} />
          ) : (
            <p role="alert" className="text-sm text-red-700">
              This link is missing its reset token. Request a new one from the{" "}
              <Link href="/login/forgot" className="font-medium underline">
                password reset page
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
