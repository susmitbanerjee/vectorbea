export default function AuditLogsLoading() {
  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8 animate-pulse">
      <div className="h-16 rounded-xl bg-muted/30" />
      <div className="h-12 rounded-xl bg-muted/20" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl border border-border/20 bg-card/20" />
      ))}
    </div>
  );
}
