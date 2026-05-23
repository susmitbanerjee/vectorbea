// Redirect: /release-gates/[versionId] → /workflows
import { redirect } from "next/navigation";

export default function ReleaseGateVersionRedirect() {
  redirect("/workflows");
}
