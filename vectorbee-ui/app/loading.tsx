function SkeletonCard() {
  return <div className="h-32 animate-pulse rounded-xl border border-border bg-muted/40" />;
}

export default function Loading() {
  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
      <div className="space-y-2">
        <div className="h-8 w-52 animate-pulse rounded-md bg-muted/50" />
        <div className="h-4 w-80 animate-pulse rounded-md bg-muted/40" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="h-[320px] animate-pulse rounded-xl border border-border bg-muted/30" />
      <div className="h-[320px] animate-pulse rounded-xl border border-border bg-muted/30" />
    </div>
  );
}
