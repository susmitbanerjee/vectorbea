// Redirect: /audit-logs → /settings
import { redirect } from "next/navigation";

export default function AuditLogsRedirect() {
  redirect("/settings");
}
