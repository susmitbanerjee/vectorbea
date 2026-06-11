// Redirect: /policies/packs → /settings
import { redirect } from "next/navigation";

export default function PoliciesPacksRedirect() {
  redirect("/settings");
}
