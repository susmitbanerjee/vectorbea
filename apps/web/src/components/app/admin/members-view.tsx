"use client";

import * as React from "react";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { RelativeTime } from "~/components/app/workflows/atoms";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";

interface MemberRecord { id: string; email: string; displayName: string; avatarUrl: string | null; role: string; joinedAt: string }

export function MembersView() {
  const api = useApi();
  const { workspaceId } = useScope();
  const me = useApiQuery({ queryKey: queryKeys.me(), queryFn: () => api.me(), enabled: Boolean(workspaceId) });
  const members = useApiQuery({
    queryKey: [...queryKeys.workspace(workspaceId), "members"],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId!)}/members`, { cache: "no-store" });
      const json = await response.json() as MemberRecord[] | { error?: string };
      if (!response.ok || !Array.isArray(json)) throw new Error(Array.isArray(json) ? "Failed to load members" : json.error ?? "Failed to load members");
      return json;
    },
  });
  const role = me.data?.workspaces.find((workspace) => workspace.id === workspaceId)?.role;

  return <PageContainer>
    <PageHeader eyebrow="Govern" title="Members" description="Active workspace memberships and their authoritative roles."
      metadata={role ? <Text variant="caption" tone="secondary">Your role in this workspace: <strong className="capitalize">{role}</strong></Text> : undefined} />
    {members.isPending ? <State text="Loading members…" /> : null}
    {members.error ? <State text={members.error.message} error /> : null}
    {members.data ? <div className="border-subtle bg-surface-raised overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[38rem]">
        <thead><tr className="border-subtle bg-surface-sunken text-fg-muted font-ui text-eyebrow border-b uppercase">
          <th className="px-3 py-2 text-left font-normal">Member</th><th className="px-3 py-2 text-left font-normal">Email</th><th className="px-3 py-2 text-left font-normal">Role</th><th className="px-3 py-2 text-left font-normal">Joined</th>
        </tr></thead>
        <tbody>{members.data.map((member) => <tr key={member.id} className="border-subtle border-b last:border-0">
          <td className="px-3 py-2"><span className="flex items-center gap-2">
            {member.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- external provider avatar, not a local asset
              <img src={member.avatarUrl} alt="" className="size-7 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="bg-accent-subtle text-accent flex size-7 shrink-0 items-center justify-center rounded-full text-caption">{member.displayName.slice(0, 1).toUpperCase()}</span>
            )}
            <Text variant="body-sm" tone="primary">{member.displayName}</Text>
          </span></td>
          <td className="px-3 py-2"><Text variant="caption" tone="secondary">{member.email}</Text></td>
          <td className="px-3 py-2"><span className="border-subtle bg-surface-sunken text-fg-secondary rounded-full border px-2 py-0.5 text-caption capitalize">{member.role}</span></td>
          <td className="px-3 py-2"><Text variant="caption" tone="muted"><RelativeTime iso={member.joinedAt} /></Text></td>
        </tr>)}</tbody>
      </table>
    </div> : null}
    <Text variant="caption" tone="muted" className="mt-2 block">Member changes and invitations are hidden because the current backend route is read-only.</Text>
  </PageContainer>;
}

function State({ text, error }: { text: string; error?: boolean }) { return <div className={error ? "border-status-failed-border bg-status-failed-subtle rounded-lg border p-5 text-center text-status-failed" : "border-subtle bg-surface-raised rounded-lg border p-5 text-center"}><Text variant="body-sm" tone="inherit">{text}</Text></div>; }
