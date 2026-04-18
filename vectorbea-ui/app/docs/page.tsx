import { redirect } from "next/navigation";

export const metadata = {
  title: "VectorBea Docs",
};

export default function DocsPage() {
  redirect("/docs/quickstart");
}
