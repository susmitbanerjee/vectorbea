import { TraceCompareShell } from "@/components/traces/trace-compare-shell";

type PageProps = {
  searchParams: Promise<{
    left?: string;
    right?: string;
  }>;
};

export default async function TraceComparePage({ searchParams }: PageProps) {
  const params = await searchParams;
  return <TraceCompareShell leftTraceId={params.left ?? ""} rightTraceId={params.right ?? ""} />;
}
