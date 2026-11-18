import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { ShopNav } from "./ShopNav";

/**
 * My Shop: how this shop itself is set up — who it is on a document, the bays
 * it books into, the hours it keeps, what it charges. Administration next door
 * is about the people; this is about the premises.
 */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!can(session.role, "settings.manage", session.extraRoles)) redirect("/app?denied=your shop's settings");

  return (
    <div>
      <ShopNav />
      {children}
    </div>
  );
}
