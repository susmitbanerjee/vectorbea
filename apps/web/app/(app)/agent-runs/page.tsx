// Permanent redirect: /agent-runs → /runs
import { redirect } from "next/navigation";

export default function AgentRunsRedirect() {
  redirect("/runs" as never);
}
