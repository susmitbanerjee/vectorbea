import { EvaluationRunShell } from "@/components/evaluations/evaluation-run-shell";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EvaluationRunPage({ params }: PageProps) {
  const { id } = await params;
  return <EvaluationRunShell runId={id} />;
}
