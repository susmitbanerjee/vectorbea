// Artifacts are now accessible inside Run Detail tabs.
// Redirect to /runs.
import { redirect } from "next/navigation";
import type { Route } from "next";

export default function ArtifactsRedirect() {
  redirect("/runs" as Route);
}
