import { redirect } from "next/navigation";

/**
 * `/agents/new` is kept as a permalink, not as a screen.
 *
 * Registration is a dialog over the registry now — you decide what an agent may
 * do by looking at the tools that already exist, and a full route throws that
 * context away. The redirect means every link, bookmark and doc that points here
 * still opens the register flow, with the list behind it.
 */
export default function NewAgentRoute() {
  redirect("/agents?create=1");
}
