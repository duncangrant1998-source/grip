import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { ForgotForm } from "./ForgotForm";

export const metadata = { title: "Reset your password — Grip" };

export default async function ForgotPasswordPage() {
  if (await getSession()) redirect("/app");

  return (
    <main className="flex min-h-screen flex-col items-center px-6 pb-16 pt-16 sm:pt-24">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo className="h-20 sm:h-24" />
        </div>
        <h1 className="mb-2 text-center text-2xl font-bold">Reset your password</h1>
        <p className="mb-6 text-center text-sm text-slate-600">
          Enter the email you sign in with and we&apos;ll send you a link to set a new password.
        </p>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ForgotForm />
        </div>
        <p className="mt-4 text-center text-sm text-slate-600">
          <Link href="/login" className="font-medium text-shop hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
