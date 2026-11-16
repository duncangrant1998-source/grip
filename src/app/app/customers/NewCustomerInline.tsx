import { ActionForm } from "@/components/ActionForm";
import { btn, input, label } from "@/components/ui";
import { VehicleFields } from "@/components/VehicleFields";
import { createCustomerWithVehicle } from "./actions";

/**
 * A customer — and, in the same step, their vehicle — added from inside
 * whatever you were doing: booking, starting a quote, changing who a work order
 * is for. `then` says where to land afterwards; the action only understands a
 * handful of known destinations.
 */
export function NewCustomerInline({
  then, title = "New customer", submitLabel = "Add customer and vehicle", vehicleRequired = true,
}: {
  then: string;
  title?: string;
  submitLabel?: string;
  vehicleRequired?: boolean;
}) {
  return (
    <ActionForm action={createCustomerWithVehicle} className="space-y-5">
      <input type="hidden" name="then" value={then} />
      <h3 className="font-semibold">{title}</h3>

      <div className="grid gap-3 sm:grid-cols-12">
        <div className="sm:col-span-6">
          <label className={label} htmlFor="nc-name">Name or company</label>
          <input id="nc-name" name="display_name" required className={`${input} w-full`} />
        </div>
        <div className="sm:col-span-3">
          <label className={label} htmlFor="nc-phone">Phone</label>
          <input id="nc-phone" name="phone" className={`${input} w-full`} />
        </div>
        <div className="sm:col-span-3">
          <label className={label} htmlFor="nc-email">Email</label>
          <input id="nc-email" name="email" type="email" className={`${input} w-full`} />
        </div>
        <div className="sm:col-span-5">
          <label className={label} htmlFor="nc-addr">Address</label>
          <input id="nc-addr" name="address_line1" className={`${input} w-full`} />
        </div>
        <div className="sm:col-span-3">
          <label className={label} htmlFor="nc-city">City</label>
          <input id="nc-city" name="city" className={`${input} w-full`} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="nc-prov">Province</label>
          <input id="nc-prov" name="region" defaultValue="ON" className={`${input} w-full`} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="nc-postal">Postal code</label>
          <input id="nc-postal" name="postal_code" className={`${input} w-full`} />
        </div>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-steel">
          Their vehicle{vehicleRequired ? "" : " (optional)"}
        </div>
        <div className="grid gap-3 sm:grid-cols-6">
          <VehicleFields prefix="v_" mileageName="v_mileage" idPrefix="nv" />
        </div>
      </div>

      <button className={btn}>{submitLabel}</button>
    </ActionForm>
  );
}
