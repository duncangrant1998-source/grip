import { PartsNav } from "./PartsNav";

export default function PartsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PartsNav />
      {children}
    </div>
  );
}
