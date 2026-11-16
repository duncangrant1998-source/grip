import { requireSession } from "@/lib/auth";
import { decodeVin } from "@/lib/vin";

export const dynamic = "force-dynamic";

/** GET /app/vin?vin=… -> the vehicle a VIN stands for, for the forms that take one. */
export async function GET(request: Request) {
  await requireSession();
  const vin = new URL(request.url).searchParams.get("vin") ?? "";
  const result = await decodeVin(vin);
  return Response.json(result, { status: "error" in result ? 422 : 200 });
}
