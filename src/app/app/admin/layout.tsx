import { SectionShell } from "@/components/SectionShell";
import { AdminNav } from "./AdminNav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <SectionShell nav={<AdminNav />}>{children}</SectionShell>;
}
