import { ActionForm } from "@/components/ActionForm";
import { btn } from "@/components/ui";
import { VehicleFields } from "@/components/VehicleFields";
import { addVehicleInline } from "./actions";

/**
 * A vehicle added to an existing customer from inside another screen, then
 * straight on to whatever you were doing (`then` — see the action).
 */
export function AddVehicleInline({
  customerId, customerName, then, submitLabel = "Add vehicle",
}: {
  customerId: string;
  customerName: string;
  then: string;
  submitLabel?: string;
}) {
  return (
    <ActionForm action={addVehicleInline} className="grid gap-3 sm:grid-cols-12">
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="then" value={then} />
      <h3 className="font-semibold sm:col-span-12">Add a vehicle to {customerName}</h3>
      <div className="grid gap-3 sm:col-span-12 sm:grid-cols-6">
        <VehicleFields idPrefix="iv" />
      </div>
      <div className="sm:col-span-12"><button className={btn}>{submitLabel}</button></div>
      <div className="flex items-end sm:col-span-3"><button className={btn}>{submitLabel}</button></div>
    </ActionForm>
  );
}
