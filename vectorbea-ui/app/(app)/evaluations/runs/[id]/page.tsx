import { BehavioralRunShell } from "@/components/evaluations/behavioral-run-shell";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function BehavioralRunPage({ params }: PageProps) {
  const { id } = await params;
  return <BehavioralRunShell runId={id} />;
}
