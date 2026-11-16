import { input, label } from "@/components/ui";
import { SupplierSelect } from "./SupplierSelect";

type Defaults = {
  sku?: string; description?: string; category?: string | null; subcategory?: string | null;
  bin_location?: string | null; unit_cost?: string; unit_price?: string; reorder_point?: number;
  reorder_qty?: number; supplier_id?: string | null; is_stocked?: boolean; fitment?: string | null;
};

export function PartFields({
  defaults = {}, suppliers, withOpeningQty, categories = [], subcategories = [],
}: {
  defaults?: Defaults;
  suppliers: { id: string; name: string }[];
  withOpeningQty?: boolean;
  /** Existing categories and sub-categories, offered as you type. Anything new is fine too. */
  categories?: string[];
  subcategories?: string[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <label className={label} htmlFor="sku">SKU</label>
        <input id="sku" name="sku" required defaultValue={defaults.sku} className={`${input} w-full font-mono uppercase`} />
      </div>
      <div className="sm:col-span-4">
        <label className={label} htmlFor="description">Description</label>
        <input id="description" name="description" required defaultValue={defaults.description} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-6">
        <label className={label} htmlFor="fitment">Fits</label>
        <input
          id="fitment" name="fitment" defaultValue={defaults.fitment ?? ""} maxLength={300}
          placeholder="Vehicles it fits, e.g. Toyota Camry 2012-2017; Toyota RAV4 2013-2018"
          className={`${input} w-full`}
        />
        <p className="mt-1 text-xs text-steel">Searching by VIN looks for the vehicle&apos;s model here and in the description.</p>
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="category">Category</label>
        <input
          id="category" name="category" list="part-categories" autoComplete="off"
          defaultValue={defaults.category ?? ""} placeholder="e.g. Brakes" className={`${input} w-full`}
        />
        <datalist id="part-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="subcategory">Sub-category</label>
        <input
          id="subcategory" name="subcategory" list="part-subcategories" autoComplete="off"
          defaultValue={defaults.subcategory ?? ""} placeholder="e.g. Pads" className={`${input} w-full`}
        />
        <datalist id="part-subcategories">{subcategories.map((c) => <option key={c} value={c} />)}</datalist>
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="bin_location">Bin / location</label>
        <input id="bin_location" name="bin_location" defaultValue={defaults.bin_location ?? ""} className={`${input} w-full`} />
      </div>
      <SupplierSelect suppliers={suppliers} defaultValue={defaults.supplier_id} />
      <div className="sm:col-span-2">
        <label className={label} htmlFor="unit_cost">Cost</label>
        <input id="unit_cost" name="unit_cost" required inputMode="decimal" defaultValue={defaults.unit_cost ?? "0"} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="unit_price">Sell price</label>
        <input id="unit_price" name="unit_price" required inputMode="decimal" defaultValue={defaults.unit_price ?? "0"} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-1">
        <label className={label} htmlFor="reorder_point">Reorder at</label>
        <input id="reorder_point" name="reorder_point" inputMode="numeric" defaultValue={defaults.reorder_point ?? 0} className={`${input} w-full`} />
      </div>
      <div className="sm:col-span-1">
        <label className={label} htmlFor="reorder_qty">Reorder qty</label>
        <input id="reorder_qty" name="reorder_qty" inputMode="numeric" defaultValue={defaults.reorder_qty ?? 0} className={`${input} w-full`} />
      </div>
      {withOpeningQty && (
        <div className="sm:col-span-2">
          <label className={label} htmlFor="opening_qty">Opening stock</label>
          <input id="opening_qty" name="opening_qty" inputMode="numeric" defaultValue={0} className={`${input} w-full`} />
        </div>
      )}
      <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-4">
        <input type="checkbox" name="is_stocked" defaultChecked={defaults.is_stocked ?? true} />
        Stocked item (tracked and reordered)
      </label>
    </div>
  );
}
