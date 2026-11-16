/**
 * VIN decoding through NHTSA's free vPIC service. Only the VIN itself is sent: it
 * identifies a model of car, nothing about the shop or the customer. NHTSA's
 * data is strongest for North American vehicles, and the trim is often missing,
 * so a decoded result is a head start to be checked, never a final answer.
 */

export type DecodedVin = {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  /** Anything NHTSA flagged, e.g. a check digit that does not add up. */
  warning: string | null;
};

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function looksLikeVin(q: string): boolean {
  return VIN.test(q.trim().toUpperCase());
}

/** NHTSA returns "TOYOTA" and "CAMRY"; shops write "Toyota" and "Camry". */
function tidy(v: string | undefined | null, keepShort = false): string | null {
  const s = (v ?? "").trim();
  if (!s || s === "Not Applicable") return null;
  if (!/[a-z]/.test(s) && !(keepShort && s.length <= 3)) {
    return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  }
  return s;
}

export async function decodeVin(raw: string): Promise<DecodedVin | { error: string }> {
  const vin = raw.trim().toUpperCase();
  if (!VIN.test(vin)) return { error: "A VIN is 17 characters and never contains I, O or Q." };

  let res: Response;
  try {
    res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 60 * 60 * 24 * 30 } },
    );
  } catch {
    return { error: "Couldn't reach the VIN lookup service. Enter the details by hand, or try again." };
  }
  if (!res.ok) return { error: "The VIN lookup service didn't answer. Try again in a moment." };

  const body = (await res.json()) as { Results?: Record<string, string>[] };
  const r = body.Results?.[0];
  if (!r) return { error: "The VIN lookup service returned nothing for that VIN." };

  const year = Number(r.ModelYear);
  const make = tidy(r.Make);
  const model = tidy(r.Model, true);
  if (!make && !model) {
    return { error: "That VIN didn't match a vehicle. Check it for a typo, or enter the details by hand." };
  }

  // Trim is split across a few fields; Trim is the one a shop would say aloud.
  // Trims are written in capitals on purpose (EX-V6, SE, LX), so they are left as given.
  const asIs = (v?: string) => (v ?? "").trim() && v!.trim() !== "Not Applicable" ? v!.trim() : null;
  const trim = asIs(r.Trim) ?? asIs(r.Series);
  const bad = (r.ErrorCode ?? "").split(",").some((c) => ["1", "2", "3", "4", "5", "6", "7", "8"].includes(c.trim()));

  return {
    vin,
    year: Number.isInteger(year) && year > 1900 ? year : null,
    make,
    model,
    trim,
    warning: bad ? (r.ErrorText ?? "").split(";")[0] || "The VIN may have a typo." : null,
  };
}
