// Legacy plural route.
import { redirect } from "next/navigation";

export default function AuditLogsRedirect() {
  redirect("/audit-log");
}
