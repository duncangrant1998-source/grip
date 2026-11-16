import { redirect } from "next/navigation";
import { requireDepartment } from "@/lib/auth";

/** The service department's home is its calendar. */
export default async function ServicePage() {
  await requireDepartment("service");
  redirect("/app/schedule");
}
