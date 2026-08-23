import { redirect } from "next/navigation";

/**
 * `/tools/new` is kept as a permalink, not as a screen. Registration is a dialog
 * over the registry — see `create-tool-dialog.tsx`.
 */
export default function NewToolRoute() {
  redirect("/tools?create=1");
}
