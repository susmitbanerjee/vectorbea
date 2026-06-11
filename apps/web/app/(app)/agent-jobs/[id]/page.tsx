// Redirect: /agent-jobs/[id] → /workflows
import { redirect } from "next/navigation";

export default function AgentJobDetailRedirect() {
  redirect("/workflows");
}
