import { redirect } from "next/navigation";

// Root → Technical dashboard by default
export default function RootPage() {
  redirect("/technical");
}
