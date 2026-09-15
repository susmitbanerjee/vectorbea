"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import { formatDuration } from "~/lib/format";
import { DetailSheet, Section, Facts } from "./detail-sheet";
import { RiskBadge, RegistryStatusBadge, HealthDot, EnvironmentScope } from "./atoms";
import { grantFindings, type AgentRecord, type ToolGrant } from "~/lib/registry/model";
import { AgentSkillGrants } from "./skills-view";
import { AgentEditor } from "./registry-editor";
import { useApi } from "~/lib/api/api-provider";
import { useScope } from "~/lib/workspace/workspace-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   AGENT DETAIL

   THE TOOL-GRANT MATRIX IS THE POINT. "5 tool grants" is a number that answers
   nothing anybody asks. What is asked is "can this agent issue a refund in
   production without a human", and that is a three-part question — which tool,
   which environments, gated or not — so the answer has to be a matrix.

   ONLY THE TABS WITH REAL DATA. Guardrails, prompt history, performance and
   "used by" rendered placeholders the API does not serve; a tab that is always
   empty reads as a broken product, so they are gone until the data exists.
══════════════════════════════════════════════════════════════════════════════ */

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "grants", label: "Tool grants" },
  /* Skills sit beside tool grants because the decision is about the two
     together: a skill that names a tool the agent does not hold is REFUSED,
     and the fix is one tab away rather than one screen away. */
  { id: "skills", label: "Skills" },
  { id: "test", label: "Test" },
];

export function AgentDetail({
  agent, open, onClose, tab, onTabChange, onUpdated,
}: {
  agent: AgentRecord | null;
  open: boolean;
  onClose: () => void;
  tab: string;
  onTabChange: (id: string) => void;
  onUpdated: () => void | Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { setEditing(false); }, [agent?.id]);
  if (!agent) return null;
  // A link saved before the unused tabs were removed still opens something.
  const activeTab = TABS.some((t) => t.id === tab) ? tab : "overview";

  const findings = grantFindings(agent);
  const connection = agent.byokConnection ? {
    status: agent.connectionStatus ?? "unknown",
    latencyMs: agent.connectionLatencyMs ?? null,
  } : undefined;

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      title={agent.name}
      subtitle={
        <>
          <span className="flex items-center gap-1.5">
            <ProviderLogo provider={agent.provider as ProviderId} size={12} decorative />
            <Text variant="caption" tone="secondary">{agent.model}</Text>
          </span>
          <Text variant="caption" tone="muted">{agent.type}</Text>
          <Text variant="caption" tone="muted">v{agent.version}</Text>
          <Text variant="caption" tone="muted">{agent.owner}</Text>
        </>
      }
      badges={
        <>
          <RegistryStatusBadge status={agent.status} />
          {findings.length > 0 ? (
            <button
              onClick={() => onTabChange("grants")}
              className={cn(
                "font-ui text-caption rounded-full border px-2 py-0.5",
                "border-status-failed-border bg-status-failed-subtle text-status-failed",
                "outline-none focus-visible:focus-ring",
              )}
            >
              {findings.length} governance {findings.length === 1 ? "finding" : "findings"}
            </button>
          ) : null}
        </>
      }
      actions={<Button size="sm" variant={editing ? "subtle" : "secondary"} onClick={() => setEditing((value) => !value)}>{editing ? "Close editor" : "Edit"}</Button>}
      tabs={TABS.map((t) => (t.id === "grants" ? { ...t, badge: findings.length } : t))}
      activeTab={activeTab}
      onTabChange={onTabChange}
    >
      <div className="grid gap-3 p-4">
        {editing ? <AgentEditor id={agent.id} onCancel={() => setEditing(false)} onSaved={async () => { await onUpdated(); setEditing(false); }} /> : <>
          {activeTab === "overview" ? <Overview agent={agent} connection={connection} /> : null}
          {activeTab === "grants" ? <Grants agent={agent} /> : null}
          {activeTab === "skills" ? (
            <Section title="Skills">
              <AgentSkillGrants agentId={agent.id} agentName={agent.name} />
            </Section>
          ) : null}
          {activeTab === "test" ? <TestConsole agent={agent} /> : null}
        </>}
      </div>
    </DetailSheet>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function Overview({ agent, connection }: { agent: AgentRecord; connection?: { status: string; latencyMs: number | null } }) {
  const [showAll, setShowAll] = React.useState(false);
  const long = agent.systemPrompt.split("\n").length > 12 || agent.systemPrompt.length > 900;

  return (
    <>
      <Section title="Model">
        <Facts
          items={[
            { label: "Model", value: agent.model },
            { label: "Provider", value: agent.provider },
            { label: "Temperature", value: agent.temperature },
            { label: "Max reply length", value: agent.maxTokens > 0 ? `${agent.maxTokens.toLocaleString("en-GB")} tokens` : "Default" },
          ]}
        />
      </Section>

      <Section title="Key">
        {agent.byokConnection ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <HealthDot status={(connection?.status as "healthy") ?? "unknown"} />
            <Text variant="body-sm" tone="primary" className="truncate">{agent.byokConnection}</Text>
            <Text variant="caption" tone="muted" className="shrink-0">{keyStatusLabel(connection)}</Text>
          </span>
        ) : (
          <Text variant="body-sm" tone="secondary">Workspace {agent.provider} key</Text>
        )}
      </Section>

      <Section
        title="Instructions"
        action={long ? (
          <Button size="xs" variant="ghost" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show less" : "Show all"}
          </Button>
        ) : undefined}
      >
        {agent.systemPrompt.trim() ? (
          <div
            className={cn(
              "border-subtle bg-surface-sunken rounded-sm border p-3",
              !showAll && long && "max-h-72 overflow-y-auto",
            )}
          >
            <Text variant="body-sm" tone="secondary" className="block whitespace-pre-wrap break-words leading-relaxed">
              {agent.systemPrompt}
            </Text>
          </div>
        ) : (
          <Text variant="body-sm" tone="muted">No instructions yet.</Text>
        )}
      </Section>
    </>
  );
}

function keyStatusLabel(connection?: { status: string; latencyMs: number | null }): string {
  if (!connection) return "";
  if (connection.status === "healthy") return connection.latencyMs ? `Connected · ${connection.latencyMs}ms` : "Connected";
  if (connection.status === "degraded") return "Degraded";
  if (connection.status === "failing") return "Failing";
  return "Not tested";
}

/* ── Tool grants ──────────────────────────────────────────────────────────── */

function Grants({ agent }: { agent: AgentRecord }) {
  const findings = grantFindings(agent);

  return (
    <>
      {findings.map((finding) => (
        <Section
          key={finding.title}
          title={finding.title}
          tone={finding.severity === "error" ? "error" : "warning"}
        >
          <Text variant="body-sm" tone="secondary" className="block">{finding.detail}</Text>
          <Text variant="caption" tone="muted" className="mt-1 block">{finding.fix}</Text>
        </Section>
      ))}

      <Section
        title="Permission matrix"
      >
        {agent.grants.length === 0 ? (
          <Text variant="body-sm" tone="secondary">
            No tools granted.
          </Text>
        ) : (
          <table className="w-full">
            <caption className="sr-only">Tool grants for {agent.name}</caption>
            <thead>
              <tr className="border-subtle text-fg-muted font-ui text-eyebrow border-b uppercase">
                <th scope="col" className="py-1 pr-2 text-left font-normal">Tool</th>
                <th scope="col" className="py-1 pr-2 text-left font-normal">Risk</th>
                <th scope="col" className="py-1 pr-2 text-left font-normal">Environments</th>
                <th scope="col" className="py-1 text-right font-normal">Gate</th>
              </tr>
            </thead>
            <tbody>
              {agent.grants.map((grant) => (
                <GrantRow key={grant.tool} grant={grant} />
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

function GrantRow({ grant }: { grant: ToolGrant }) {
  const risky = (grant.risk === "high" || grant.risk === "critical") && !grant.requiresApproval;

  return (
    <tr className={cn("border-subtle border-b last:border-b-0", risky && "bg-status-failed-subtle")}>
      <td className="py-1.5 pr-2">
        <Text variant="mono-sm" tone="primary" className="block truncate">{grant.tool}</Text>
      </td>
      <td className="py-1.5 pr-2"><RiskBadge risk={grant.risk} /></td>
      <td className="py-1.5 pr-2"><EnvironmentScope environments={grant.environments} /></td>
      <td className="py-1.5 text-right">
        {grant.requiresApproval ? (
          <Text variant="caption" tone="inherit" className="text-status-success">Approval</Text>
        ) : (
          <Text
            variant="caption"
            tone="inherit"
            className={risky ? "text-status-failed" : "text-fg-muted"}
            title={risky ? "A high-risk tool that runs without a human decision" : undefined}
          >
            None
          </Text>
        )}
      </td>
    </tr>
  );
}

/* ── Test console ─────────────────────────────────────────────────────────── */

function TestConsole({ agent }: { agent: AgentRecord }) {
  const api = useApi();
  const { workspaceId } = useScope();
  const [running, setRunning] = React.useState(false);
  const [trace, setTrace] = React.useState<{ step: string; detail: string; ms: number }[] | null>(null);

  const run = async () => {
    setRunning(true);
    const started = performance.now();
    try {
      const result = await api.agents.test(agent.id, { workspaceId, environmentId: null });
      setTrace([{ step: result.valid ? "Passed" : "Failed", detail: result.message, ms: Math.round(performance.now() - started) }]);
    } catch (error) {
      setTrace([{ step: "Failed", detail: error instanceof Error ? error.message : "Agent readiness test failed.", ms: Math.round(performance.now() - started) }]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Section title="Test" help="Checks the agent's settings and model key. No tools are called.">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => void run()} loading={running}>
            {running ? "Testing" : "Run test"}
          </Button>
        </div>
      </Section>

      {trace ? (
        <Section title="Result">
          <ol className="grid gap-1.5">
            {trace.map((entry, i) => (
              <li key={i} className="border-subtle flex items-baseline gap-2 border-b pb-1.5 last:border-b-0">
                <Text variant="caption" tone="disabled" tabular className="w-5 shrink-0">{i + 1}</Text>
                <span className="min-w-0 flex-1">
                  <Text variant="body-sm" tone="primary" className="block">{entry.step}</Text>
                  <Text variant="caption" tone="muted" className="block break-words">{entry.detail}</Text>
                </span>
                <Text variant="caption" tone="secondary" tabular className="shrink-0">
                  {entry.ms > 0 ? formatDuration(entry.ms) : "—"}
                </Text>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}
    </>
  );
}

export { TABS as AGENT_DETAIL_TABS };
