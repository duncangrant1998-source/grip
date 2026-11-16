import { redirect } from "next/navigation";

/** Bays moved to My Shop; keep old links and bookmarks working. */
export default function MovedToMyShop() {
  redirect("/app/shop/bays");
}
