import { redirect } from "next/navigation";

/**
 * `/workflows/new` is kept as a permalink, not as a screen.
 *
 * The chooser it used to render — Architect, template, import, manual — is the
 * first step of the create dialog now, so the decision is made in front of the
 * workflow list rather than on a page of its own. `/workflows/new/architect` is
 * a separate route segment and is untouched by this.
 */
export default function NewWorkflowRoute() {
  redirect("/workflows?create=1");
}
