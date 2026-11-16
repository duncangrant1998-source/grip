import { requireDepartment } from "@/lib/auth";
import { partsWorkOrders } from "@/lib/parts-queries";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PartsOrdersList } from "../PartsOrdersList";

export const dynamic = "force-dynamic";

export default async function OpenWorkOrdersPage() {
  const session = await requireDepartment("parts");
  const rows = await partsWorkOrders(session, "open");

  return (
    <div className="space-y-5">
      <LiveRefresh everyMs={10000} />
      <div>
        <h1 className="text-2xl font-bold">Open work orders</h1>
        <p className="text-sm text-steel">
          Vehicles in the shop now. Open one to add the parts it needs — they are reserved from
          stock straight away.
        </p>
      </div>
      <PartsOrdersList rows={rows} kind="open" />
    </div>
  );
}
