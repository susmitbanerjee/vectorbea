"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { RelativeTime } from "~/components/app/workflows/atoms";
import { cn } from "~/lib/cn";
import { useApi } from "~/lib/api/api-provider";
import { useSchedulesData } from "./use-schedules-data";

export function TriggersView() {
  const api = useApi();
  const data = useSchedulesData();
  const [changing, setChanging] = React.useState<string | null>(null);

  const toggle = async (id: string, enabled: boolean) => {
    setChanging(id);
    try {
      await api.schedules.setEnabled(id, enabled, data.scope);
      await data.refetch();
    } finally { setChanging(null); }
  };

  return (
    <PageContainer>
      <PageHeader eyebrow="Automate" title="Triggers" description="Cron schedules materialized from published workflow trigger configuration."
        actions={<Button asChild size="sm"><Link href={"/workflows" as Route}>Configure in workflow</Link></Button>} />
      {data.error ? <State title="Could not load triggers" detail="The schedules API did not respond. Try refreshing." tone="error" /> : null}
      {data.loading ? <State title="Loading triggers…" detail="Reading workspace schedules." /> : null}
      {!data.loading && !data.error && data.rows.length === 0 ? <State title="No scheduled triggers" detail="Add a cron trigger to a workflow version and publish it to create a schedule." /> : null}
      {!data.loading && data.rows.length > 0 ? (
        <div className="border-subtle bg-surface-raised overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[44rem]">
            <thead><tr className="border-subtle bg-surface-sunken text-fg-muted font-ui text-eyebrow border-b uppercase">
              {['Workflow','Schedule','Timezone','Last run','Next run','State'].map((label) => <th key={label} className={cn("px-3 py-2 font-normal", label === 'State' ? "text-right" : "text-left")}>{label}</th>)}
            </tr></thead>
            <tbody>{data.rows.map((schedule) => {
              const active = schedule.status === "ACTIVE";
              return <tr key={schedule.id} className="border-subtle border-b last:border-0">
                <td className="px-3 py-2"><Link className="text-fg-primary hover:text-accent text-body-sm" href={`/workflows/${schedule.jobId}` as Route}>{schedule.jobName}</Link></td>
                <td className="px-3 py-2"><Text variant="caption" tone="secondary" className="font-code">{schedule.cron}</Text></td>
                <td className="px-3 py-2"><Text variant="caption" tone="secondary">{schedule.timezone}</Text></td>
                <td className="px-3 py-2"><Text variant="caption" tone="muted">{schedule.lastRun ? <RelativeTime iso={schedule.lastRun} /> : "Never"}</Text></td>
                <td className="px-3 py-2"><Text variant="caption" tone="secondary">{schedule.nextRun ? <RelativeTime iso={schedule.nextRun} /> : "Not scheduled"}</Text></td>
                <td className="px-3 py-2 text-right"><Button size="xs" variant={active ? "secondary" : "primary"} loading={changing === schedule.id} onClick={() => void toggle(schedule.id, !active)}>{active ? "Pause" : "Resume"}</Button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      ) : null}
    </PageContainer>
  );
}

function State({ title, detail, tone }: { title: string; detail: string; tone?: "error" }) {
  return <div className={cn("rounded-lg border p-5 text-center", tone === "error" ? "border-status-failed-border bg-status-failed-subtle" : "border-subtle bg-surface-raised")}>
    <Text variant="heading-sm" tone="max" className="block">{title}</Text><Text variant="body-sm" tone="muted" className="mt-1 block">{detail}</Text>
  </div>;
}
