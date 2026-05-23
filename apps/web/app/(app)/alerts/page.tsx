// Redirect: /alerts → /runs
import { redirect } from "next/navigation";
import type { Route } from "next";

export default function AlertsRedirect() {
  redirect("/runs" as Route);
}
