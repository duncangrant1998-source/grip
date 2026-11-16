import { redirect } from "next/navigation";

/** Shop settings moved to My Shop; keep old links and bookmarks working. */
export default function MovedToMyShop() {
  redirect("/app/shop");
}
