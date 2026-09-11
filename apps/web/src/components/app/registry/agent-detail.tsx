"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/choice";
import { Spinner } from "~/components/ui/spinner";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import { formatCost, formatDuration, formatTokens } from "~/lib/format";
import { DetailSheet, Section, Facts } from "./detail-sheet";
import { RiskBadge, RegistryStatusBadge, HealthDot, EnvironmentScope, Sparkline, DistributionBar } from "./atoms";
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

   PROMPT VERSION HISTORY, because a prompt IS the agent's behaviour and it was
   the one thing in the product that changed with no record. A model change is
   visible in the config; a sentence added to a system prompt is not, and it can
   move the success rate further.
══════════════════════════════════════════════════════════════════════════════ */

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "grants", label: "Tool grants" },
  /* Skills sit beside tool grants because the decision is about the two
     together: a skill that names a tool the agent does not hold is REFUSED,
     and the fix is one tab away rather than one screen away. */
  { id: "skills", label: "Skills" },
  { id: "guardrails", label: "Guardrails" },
  { id: "prompt", label: "Prompt history" },
  { id: "performance", label: "Performance" },
  { id: "usage", label: "Used by" },
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
      activeTab={tab}
      onTabChange={onTabChange}
    >
      <div className="grid gap-3 p-4">
        {editing ? <AgentEditor id={agent.id} onCancel={() => setEditing(false)} onSaved={async () => { await onUpdated(); setEditing(false); }} /> : <>
          {tab === "overview" ? <Overview agent={agent} connection={connection} /> : null}
          {tab === "grants" ? <Grants agent={agent} /> : null}
          {tab === "skills" ? (
            <Section
              title="Skills"
              help="Named instructions this agent works from. A skill teaches it how — it can never let it do something it was not already granted."
            >
              <AgentSkillGrants agentId={agent.id} agentName={agent.name} />
            </Section>
          ) : null}
          {tab === "guardrails" ? <GuardrailsPane agent={agent} /> : null}
          {tab === "prompt" ? <PromptHistory agent={agent} /> : null}
          {tab === "performance" ? <Performance agent={agent} /> : null}
          {tab === "usage" ? <UsedBy agent={agent} /> : null}
          {tab === "test" ? <TestConsole agent={agent} /> : null}
        </>}
      </div>
    </DetailSheet>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function Overview({ agent, connection }: { agent: AgentRecord; connection?: { status: string; latencyMs: number | null } }) {
  const [showPrompt, setShowPrompt] = React.useState(false);

  return (
    <>
      <Section title="Model" help="What runs when a step binds this agent.">
        <Facts
          items={[
            { label: "Model", value: agent.model },
            { label: "Provider", value: agent.provider },
            { label: "Temperature", value: agent.temperature },
            { label: "Max tokens", value: agent.maxTokens.toLocaleString("en-GB") },
            { label: "Output schema", value: agent.outputSchema },
            { label: "Type", value: agent.type },
          ]}
        />
      </Section>

      <Section
        title="Key"
        help="Whose credentials the calls run under. A workspace key is billed to the workspace; a bring-your-own key is billed to you and is not shared."
      >
        {agent.byokConnection ? (
          <span className="flex items-center gap-1.5">
            <HealthDot status={(connection?.status as "healthy") ?? "unknown"} />
            <Text variant="body-sm" tone="primary">{agent.byokConnection}</Text>
            <Text variant="caption" tone="muted">
              {connection?.latencyMs ? `${connection.latencyMs}ms` : connection?.status ?? "not registered"}
            </Text>
          </span>
        ) : (
          <Text variant="body-sm" tone="secondary">
            Uses the workspace&apos;s pooled {agent.provider} key. Spend counts against the workspace budget.
          </Text>
        )}
      </Section>

      <Section
        title="System prompt"
        help="The instruction every run of this agent starts from."
        action={
          <Button size="xs" variant="ghost" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? "Collapse" : "Expand"}
          </Button>
        }
      >
        <pre
          className={cn(
            "border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary overflow-auto rounded-sm border p-2",
            showPrompt ? "max-h-80" : "max-h-20",
          )}
        >
          {/* Syntax-aware in the sense that matters here: the directive lines
              an operator scans for are picked out from the prose around them. */}
          {agent.systemPrompt.split("\n").map((line, i) => (
            <span
              key={i}
              className={cn(
                "block",
                /^(You are|Do not|If |Cite|Never|Always)/.test(line.trim()) && "text-fg-primary",
              )}
            >
              {line || " "}
            </span>
          ))}
        </pre>
      </Section>
    </>
  );
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
        help="Which tools this agent may call, at what risk, in which environments, and whether a human has to approve first. This is the whole of what the agent is permitted to do."
      >
        {agent.grants.length === 0 ? (
          <Text variant="body-sm" tone="secondary">
            No tools granted. This agent can reason and produce text, but it cannot act on anything.
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

/* ── Guardrails ───────────────────────────────────────────────────────────── */

function GuardrailsPane({ agent }: { agent: AgentRecord }) {
  const g = agent.guardrails;
  return (
    <>
      <Section
        title="Loop bounds"
        help="An agent decides how many steps it needs, so the bound has to come from outside it. Without one, a confused agent burns the budget rather than stopping."
      >
        <Facts
          items={[
            { label: "Max iterations", value: g.maxIterations },
            { label: "Cost ceiling per run", value: formatCost(g.costCeilingUsd) },
            { label: "Timeout", value: formatDuration(g.timeoutMs) },
            { label: "Typical cost", value: formatCost(agent.avgCostUsd) },
          ]}
        />
        <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
          The ceiling is {(g.costCeilingUsd / Math.max(agent.avgCostUsd, 0.0001)).toFixed(0)}× the
          average run, so it stops a runaway without tripping on a normal one.
        </Text>
      </Section>

      <Section title="Content filters" help="Applied to everything the agent emits, before it reaches a tool or a person.">
        <ul className="flex flex-wrap gap-1.5">
          {g.contentFilters.map((filter) => (
            <li key={filter} className="border-accent-border bg-accent-subtle text-accent font-code rounded-xs border px-1.5 py-0.5 text-[10px]">
              {filter}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Forbidden actions" help="Refused even when a tool grant would otherwise permit them. The last line, not the first.">
        <ul className="flex flex-wrap gap-1.5">
          {g.forbiddenActions.map((action) => (
            <li key={action} className="border-status-failed-border bg-status-failed-subtle text-status-failed font-code rounded-xs border px-1.5 py-0.5 text-[10px]">
              {action}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ── Prompt history ───────────────────────────────────────────────────────── */

function PromptHistory({ agent }: { agent: AgentRecord }) {
  const [selected, setSelected] = React.useState(agent.promptVersions.length - 1);
  const current = agent.promptVersions[selected];
  const previous = selected > 0 ? agent.promptVersions[selected - 1] : null;

  const diff = React.useMemo(() => {
    if (!previous) return null;
    const before = previous.text.split("\n");
    const after = current.text.split("\n");
    return after.map((line) => ({ line, added: !before.includes(line) }))
      .concat(before.filter((line) => !after.includes(line)).map((line) => ({ line, added: false, removed: true } as never)));
  }, [current, previous]);

  return (
    <>
      <Section
        title="Versions"
        help="A prompt is the agent's behaviour. Changing one is a deploy, and this is the record of it."
      >
        <ol className="grid gap-1">
          {[...agent.promptVersions].reverse().map((version) => {
            const index = agent.promptVersions.indexOf(version);
            return (
              <li key={version.version}>
                <button
                  onClick={() => setSelected(index)}
                  aria-pressed={selected === index}
                  className={cn(
                    "flex w-full flex-col rounded-sm border px-2 py-1.5 text-left",
                    "transition-colors duration-fast outline-none focus-visible:focus-ring",
                    selected === index ? "border-accent-border bg-surface-selected" : "border-transparent hover:bg-surface-hover",
                  )}
                >
                  <span className="flex items-baseline gap-2">
                    <Text variant="body-sm" tone="primary" tabular>v{version.version}</Text>
                    <Text variant="caption" tone="muted" className="ml-auto">{version.author}</Text>
                  </span>
                  <Text variant="caption" tone="secondary" className="block">{version.summary}</Text>
                </button>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section
        title={previous ? `v${previous.version} → v${current.version}` : `v${current.version}`}
        help={previous ? "Added lines in verdant. This is what changed about how the agent behaves." : "The first version."}
      >
        <pre className="border-subtle bg-surface-sunken font-code text-mono-sm overflow-auto rounded-sm border p-2">
          {(diff ?? current.text.split("\n").map((line) => ({ line, added: false }))).map((row, i) => (
            <span
              key={i}
              className={cn(
                "block",
                (row as { added: boolean }).added ? "text-status-success" : "text-fg-secondary",
                (row as { removed?: boolean }).removed && "text-status-failed line-through",
              )}
            >
              {(row as { added: boolean }).added ? "+ " : (row as { removed?: boolean }).removed ? "− " : "  "}
              {row.line || " "}
            </span>
          ))}
        </pre>
      </Section>
    </>
  );
}

/* ── Performance ──────────────────────────────────────────────────────────── */

function Performance({ agent }: { agent: AgentRecord }) {
  return (
    <>
      <Section title="Success rate — 30 days" help="Per day. A step change usually lines up with a prompt or model version.">
        <div className="flex items-center gap-3">
          <Sparkline values={agent.successTrend} width={280} height={44} tone="success" label="Success rate over 30 days" />
          <Text variant="heading-sm" tone="max" tabular>{agent.successRate}%</Text>
        </div>
      </Section>

      <Section title="Cost per run — 30 days" help="What one execution of this agent costs.">
        <div className="flex items-center gap-3">
          <Sparkline values={agent.costTrend.map((c) => c * 10000)} width={280} height={44} label="Cost per run over 30 days" />
          <Text variant="heading-sm" tone="max" tabular>{formatCost(agent.avgCostUsd)}</Text>
        </div>
      </Section>

      <Section title="Token distribution" help="How much context the agent actually consumes. A long tail here is where the cost goes.">
        <DistributionBar
          buckets={agent.tokenBuckets.map((b) => ({ label: formatTokens(b.upper), count: b.count }))}
          label="Tokens per run"
        />
      </Section>

      <Section title="Why it fails" help="Grouped by cause, so the fix is obvious rather than statistical.">
        {agent.failureReasons.length === 0 ? (
          <Text variant="body-sm" tone="secondary">No failures recorded in the last 30 days.</Text>
        ) : (
          <ul className="grid gap-1.5">
            {agent.failureReasons.map((reason) => (
              <li key={reason.reason} className="flex items-baseline gap-2">
                <Text variant="body-sm" tone="secondary" className="min-w-0 flex-1">{reason.reason}</Text>
                <Text variant="body-sm" tone="primary" tabular className="shrink-0">{reason.count}</Text>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/* ── Used by ──────────────────────────────────────────────────────────────── */

function UsedBy({ agent }: { agent: AgentRecord }) {
  return (
    <Section
      title="Referenced by"
      help="Every workflow step bound to this agent. Change its prompt or its grants and these are what change with it."
    >
      {agent.usedBy.length === 0 ? (
        <Text variant="body-sm" tone="secondary">
          Nothing references this agent yet, so it is safe to change freely.
        </Text>
      ) : (
        <ul className="grid gap-1">
          {agent.usedBy.map((ref) => (
            <li key={`${ref.workflowId}-${ref.nodeId}`}>
              <Link
                href={`/workflows/${ref.workflowId}` as Route}
                className={cn(
                  "-mx-1 flex items-baseline gap-2 rounded-sm px-1 py-1",
                  "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
                )}
              >
                <Text variant="body-sm" tone="primary" className="truncate">{ref.workflowName}</Text>
                <Text variant="caption" tone="muted" className="truncate">{ref.nodeName}</Text>
                <Text variant="caption" tone="disabled" className="ml-auto shrink-0">{ref.environment}</Text>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
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
      setTrace([{ step: result.valid ? "Readiness passed" : "Readiness failed", detail: result.message, ms: Math.round(performance.now() - started) }]);
    } catch (error) {
      setTrace([{ step: "Readiness failed", detail: error instanceof Error ? error.message : "Agent readiness test failed.", ms: Math.round(performance.now() - started) }]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Section title="Readiness test" help="Validates the saved agent and tests its registered model connection through the API. No tool side effects are executed.">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => void run()} loading={running}>
            {running ? "Testing" : "Test readiness"}
          </Button>
          {running ? <Spinner className="size-4" /> : null}
        </div>
      </Section>

      {trace ? (
        <Section title="Readiness result" help="The API result from validating the saved definition and its model connection.">
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
