function Zone({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <div className="rounded-3xl border border-border/70 bg-card/95 p-5 shadow-[0_24px_70px_-54px_rgba(15,23,42,0.55)]">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h3>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-5 grid gap-3">
        {items.map((item) => (
          <div
            key={item}
            className="rounded-2xl border border-border/70 bg-background/85 px-4 py-3 text-sm font-medium text-foreground"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArchitectureDiagram() {
  return (
    <div className="my-10 rounded-[2rem] border border-border/70 bg-gradient-to-b from-background to-muted/20 p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] lg:items-center">
        <Zone
          title="VectorBea Control Plane"
          description="Centralized governance lives here: UI, API routes, and Supabase-backed state."
          items={["Next.js UI", "Route Handlers / API", "Supabase Database"]}
        />

        <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-brand/40 bg-brand/5 px-4 py-5 text-center">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-brand/50 to-transparent lg:hidden" />
          <div className="hidden h-full w-px bg-gradient-to-b from-transparent via-brand/50 to-transparent lg:block" />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            HTTPS Outbound Heartbeat
          </p>
          <p className="text-sm text-muted-foreground">Port 443</p>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-brand/40 bg-background text-brand">
            →
          </div>
        </div>

        <Zone
          title="Customer Environment"
          description="Execution stays behind the customer boundary while VectorBea syncs only control-plane state."
          items={[
            "Firewall / Network Boundary",
            "VectorBea Agent",
            "AI Microservices",
          ]}
        />
      </div>
    </div>
  );
}
