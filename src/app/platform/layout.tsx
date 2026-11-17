import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth";
import { unreadNotificationCount } from "@/lib/platform-queries";
import { PlatformNav } from "./PlatformNav";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatformAdmin();
  const unreadCount = await unreadNotificationCount(session);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Platform console</h1>
        <Link href="/app" className="text-sm text-steel hover:text-ink">
          ← Back to portal
        </Link>
      </div>
      <PlatformNav unreadCount={unreadCount} />
      {children}
    </div>
  );
}
