// Redirect: /agent-jobs/new → /workflows/new
import { redirect } from "next/navigation";

export default function AgentJobNewRedirect() {
  redirect("/workflows/new");
}
