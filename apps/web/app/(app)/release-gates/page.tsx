// Redirect: /release-gates → /workflows
import { redirect } from "next/navigation";

export default function ReleaseGatesRedirect() {
  redirect("/workflows");
}
