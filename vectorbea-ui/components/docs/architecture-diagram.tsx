import { ArrowRight } from "lucide-react";

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
    <div className="my-6 rounded-[2rem] border border-border/70 bg-gradient-to-b from-background to-muted/20 p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] lg:items-center">
        <Zone
          title="VectorBea Control Plane"
          description="Hosted by VectorBea. Prompt publication, workspace state, access control, and billing are managed here."
          items={["Dashboard UI", "Control Plane API", "Workspace Metadata"]}
        />

        <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-brand/40 bg-brand/5 px-4 py-5 text-center">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-brand/50 to-transparent lg:hidden" />
          <div className="hidden h-full w-px bg-gradient-to-b from-transparent via-brand/50 to-transparent lg:block" />
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            HTTPS outbound heartbeat
          </p>
          <p className="text-sm text-muted-foreground">Port 443</p>
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-brand/40 bg-background text-brand">
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>

        <Zone
          title="Customer Environment"
          description="Owned by the customer. The application, sidecar, and model execution stay here while only control-plane state crosses the boundary."
          items={[
            "Firewall and Egress Policy",
            "VectorBea Sidecar",
            "AI Microservices",
          ]}
        />
      </div>
    </div>
  );
}
