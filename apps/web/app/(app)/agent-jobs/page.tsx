// Redirect: /agent-jobs → /workflows
import { redirect } from "next/navigation";

export default function AgentJobsRedirect() {
  redirect("/workflows");
}
