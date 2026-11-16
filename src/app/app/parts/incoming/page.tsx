import { requireDepartment } from "@/lib/auth";
import { partsWorkOrders } from "@/lib/parts-queries";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PartsOrdersList } from "../PartsOrdersList";

export const dynamic = "force-dynamic";

export default async function IncomingWorkOrdersPage() {
  const session = await requireDepartment("parts");
  const rows = await partsWorkOrders(session, "incoming");

  return (
    <div className="space-y-5">
      <LiveRefresh everyMs={15000} />
      <div>
        <h1 className="text-2xl font-bold">Incoming work orders</h1>
        <p className="text-sm text-steel">
          Vehicles booked in but not here yet, soonest first. Parts added now are reserved, so the
          order is ready when the customer arrives; anything out of stock goes on backorder.
        </p>
      </div>
      <PartsOrdersList rows={rows} kind="incoming" />
    </div>
  );
}
