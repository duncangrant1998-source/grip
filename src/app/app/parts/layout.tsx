import { SectionShell } from "@/components/SectionShell";
import { PartsNav } from "./PartsNav";

export default function PartsLayout({ children }: { children: React.ReactNode }) {
  return <SectionShell nav={<PartsNav />}>{children}</SectionShell>;
}
