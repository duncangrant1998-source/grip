import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — Grip" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ changed?: string }>;
}) {
  // Already signed in: go straight to your shop.
  if (await getSession()) redirect("/app");
  const { changed } = await searchParams;

  return (
    // Sits towards the top rather than centred in the viewport, so the mark is
    // the first thing on the page instead of floating in the middle of it.
    <main className="flex min-h-screen flex-col items-center px-6 pb-16 pt-16 sm:pt-24">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo className="h-20 sm:h-24" />
        </div>
        <h1 className="mb-6 text-center text-2xl font-bold">Sign in to your shop</h1>
        {changed && (
          <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Password changed. Sign in with your new password.
          </p>
        )}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
