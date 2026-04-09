export default function DashboardLoading() {
  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8 animate-pulse">
      {/* Header */}
      <div className="h-16 rounded-xl bg-muted/30" />

      {/* Metric cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl border border-border/40 bg-card/30" />
        ))}
      </div>

      {/* Chart + signals */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="h-64 rounded-2xl border border-border/40 bg-card/30" />
        <div className="h-64 rounded-2xl border border-border/40 bg-card/30" />
      </div>

      {/* Table */}
      <div className="space-y-2">
        <div className="h-10 rounded-xl bg-muted/20" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded-xl bg-muted/10" />
        ))}
      </div>
    </div>
  );
}
