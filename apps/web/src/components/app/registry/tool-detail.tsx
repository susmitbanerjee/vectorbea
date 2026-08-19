"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/choice";
import { formatDuration } from "~/lib/format";
import { DetailSheet, Section, Facts } from "./detail-sheet";
import { RiskBadge, RegistryStatusBadge, HealthDot, EnvironmentScope, Sparkline, DistributionBar } from "./atoms";
import { policyFindings, policyForRisk, TOOL_TYPE_LABEL, type ToolRecord, type SchemaParameter } from "~/lib/registry/model";

/* ══════════════════════════════════════════════════════════════════════════════
   TOOL DETAIL

   RISK & POLICY IS WHERE THE RISK LEVELS FINALLY DO SOMETHING. Until now a tool
   was labelled "high" and nothing followed from it. Here each tier carries what
   it requires — a gate, an environment scope, a rate limit, forced audit — and
   the panel states plainly when the configured policy contradicts the tier it
   claims. A high-risk tool that can bypass approval is not a preference; it is a
   control somebody switched off, and it is reported as one.

   THE SCHEMA IS AN API REFERENCE, not a form dump: types, requiredness,
   defaults and validation rules, because the person reading it is deciding what
   to bind, not filling it in.
══════════════════════════════════════════════════════════════════════════════ */

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "schema", label: "Schema" },
  { id: "policy", label: "Risk & policy" },
  { id: "reliability", label: "Reliability" },
  { id: "usage", label: "Used by" },
  { id: "versions", label: "Versions" },
  { id: "test", label: "Test" },
];

export function ToolDetail({
  tool, open, onClose, tab, onTabChange,
}: {
  tool: ToolRecord | null;
  open: boolean;
  onClose: () => void;
  tab: string;
  onTabChange: (id: string) => void;
}) {
  if (!tool) return null;

  const findings = policyFindings(tool);
  const connection = tool.connection ? {
    status: tool.connectionStatus ?? "unknown",
    latencyMs: tool.connectionLatencyMs ?? null,
  } : undefined;

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      title={tool.name}
      subtitle={
        <>
          <Text variant="caption" tone="secondary">{TOOL_TYPE_LABEL[tool.type]}</Text>
          <RiskBadge risk={tool.risk} />
          {tool.connection ? (
            <span className="flex items-center gap-1.5">
              <HealthDot status={(connection?.status as "healthy") ?? "unknown"} />
              <Text variant="caption" tone="muted">{tool.connection}</Text>
            </span>
          ) : null}
          <Text variant="caption" tone="muted">{tool.owner}</Text>
        </>
      }
      badges={
        <>
          <RegistryStatusBadge status={tool.status} />
          {findings.length > 0 ? (
            <button
              onClick={() => onTabChange("policy")}
              className={cn(
                "font-ui text-caption rounded-full border px-2 py-0.5 outline-none focus-visible:focus-ring",
                findings.some((f) => f.severity === "error")
                  ? "border-status-failed-border bg-status-failed-subtle text-status-failed"
                  : "border-status-waiting-border bg-status-waiting-subtle text-status-waiting",
              )}
            >
              {findings.length} policy {findings.length === 1 ? "finding" : "findings"}
            </button>
          ) : null}
        </>
      }
      actions={<Button size="sm" variant="secondary">Edit</Button>}
      tabs={TABS.map((t) => (t.id === "policy" ? { ...t, badge: findings.length } : t))}
      activeTab={tab}
      onTabChange={onTabChange}
    >
      <div className="grid gap-3 p-4">
        {tab === "overview" ? <Overview tool={tool} connection={connection} /> : null}
        {tab === "schema" ? <Schema tool={tool} /> : null}
        {tab === "policy" ? <Policy tool={tool} /> : null}
        {tab === "reliability" ? <Reliability tool={tool} /> : null}
        {tab === "usage" ? <UsedBy tool={tool} /> : null}
        {tab === "versions" ? <Versions tool={tool} /> : null}
        {tab === "test" ? <TestConsole tool={tool} /> : null}
      </div>
    </DetailSheet>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

function Overview({ tool, connection }: { tool: ToolRecord; connection?: { status: string; latencyMs: number | null; blastRadius?: { workflows: number; tools: number } } }) {
  return (
    <>
      <Section title="What it does" help="">
        <Text variant="body-sm" tone="secondary">{tool.description}</Text>
      </Section>

      <Section title="Call" help="Where the request goes and what authenticates it.">
        <Facts
          items={[
            { label: "Type", value: TOOL_TYPE_LABEL[tool.type] },
            { label: "Timeout", value: formatDuration(tool.timeoutMs) },
            { label: "Auth", value: tool.authMethod },
            { label: "p95 latency", value: formatDuration(tool.p95LatencyMs) },
          ]}
        />
        <pre className="border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary mt-2 overflow-auto rounded-sm border p-2">
          {tool.endpoint}
        </pre>
      </Section>

      {tool.connection ? (
        <Section title="Connection" help="The credentials this tool runs under, and what else depends on them.">
          <span className="flex flex-wrap items-center gap-2">
            <HealthDot status={(connection?.status as "healthy") ?? "unknown"} />
            <Text variant="body-sm" tone="primary">{tool.connection}</Text>
            <Text variant="caption" tone="muted">
              {connection?.latencyMs ? `${connection.latencyMs}ms` : connection?.status ?? "not registered"}
            </Text>
          </span>
          {connection?.blastRadius ? (
            <Text variant="caption" tone="muted" className="mt-1.5 block">
              {connection.blastRadius.workflows} workflows and {connection.blastRadius.tools} tools
              share this connection — if it fails, they all fail together.
            </Text>
          ) : null}
        </Section>
      ) : null}

      {tool.lastError ? (
        <Section title="Last error" tone="warning">
          <Text variant="body-sm" tone="secondary">{tool.lastError}</Text>
        </Section>
      ) : null}
    </>
  );
}

/* ── Schema ───────────────────────────────────────────────────────────────── */

function Schema({ tool }: { tool: ToolRecord }) {
  return (
    <>
      <Section title="Parameters" help="What the tool accepts. Bound on a node's Inputs tab, where each one resolves against real data.">
        <ParameterTable parameters={tool.parameters} />
      </Section>

      <Section title="Returns" help="What the tool emits. These are the fields downstream steps can bind.">
        <ParameterTable parameters={tool.outputFields} hideRequired />
      </Section>
    </>
  );
}

function ParameterTable({ parameters, hideRequired }: { parameters: SchemaParameter[]; hideRequired?: boolean }) {
  return (
    <dl className="grid gap-2.5">
      {parameters.map((p) => (
        <div key={p.name} className="border-subtle border-b pb-2.5 last:border-b-0 last:pb-0">
          <dt className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <code className="font-code text-mono-sm text-fg-primary">{p.name}</code>
            <span className="border-subtle text-fg-muted font-code rounded-xs border px-1 text-[10px]">{p.type}</span>
            {!hideRequired ? (
              p.required
                ? <Text variant="caption" tone="inherit" className="text-status-failed">required</Text>
                : <Text variant="caption" tone="disabled">optional</Text>
            ) : null}
            {p.defaultValue !== undefined ? (
              <Text variant="caption" tone="muted">default <code className="font-code">{p.defaultValue}</code></Text>
            ) : null}
          </dt>
          <dd className="mt-0.5">
            <Text variant="caption" tone="secondary" className="block leading-snug">{p.description}</Text>
            {p.validation ? (
              <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{p.validation}</Text>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Risk & policy ────────────────────────────────────────────────────────── */

function Policy({ tool }: { tool: ToolRecord }) {
  const findings = policyFindings(tool);
  const expected = policyForRisk(tool.risk);

  return (
    <>
      {findings.map((finding) => (
        <Section key={finding.title} title={finding.title} tone={finding.severity === "error" ? "error" : "warning"}>
          <Text variant="body-sm" tone="secondary" className="block">{finding.detail}</Text>
          <Text variant="caption" tone="muted" className="mt-1 block">{finding.fix}</Text>
        </Section>
      ))}

      <Section
        title={`Policy for ${tool.risk} risk`}
        help="What this tier requires, and what is actually configured. Where they differ, the difference is the finding above."
      >
        <ul className="grid gap-2">
          <PolicyRow
            label="Requires an approval gate"
            help="A human decision before the call executes."
            expected={expected.requiresApprovalGate}
            actual={tool.policy.requiresApprovalGate}
          />
          <PolicyRow
            label="Always audited"
            help="An audit record whatever the workspace default is."
            expected={expected.auditAlways}
            actual={tool.policy.auditAlways}
          />
          <li className="border-subtle flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0">
            <span className="min-w-0">
              <Text variant="body-sm" tone="primary" className="block">Allowed environments</Text>
              <Text variant="caption" tone="muted" className="block leading-snug">
                The tier permits {expected.allowedEnvironments.join(", ")}.
              </Text>
            </span>
            <EnvironmentScope environments={tool.policy.allowedEnvironments} />
          </li>
          <li className="border-subtle flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0">
            <span className="min-w-0">
              <Text variant="body-sm" tone="primary" className="block">Rate limit</Text>
              <Text variant="caption" tone="muted" className="block leading-snug">
                Calls per minute across the workspace.
              </Text>
            </span>
            <Text variant="body-sm" tone="secondary" tabular>
              {tool.policy.rateLimitPerMinute ?? "None"}
            </Text>
          </li>
          <li className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <Text variant="body-sm" tone="primary" className="block">Allowed agents</Text>
              <Text variant="caption" tone="muted" className="block leading-snug">
                Empty means any agent granted this tool may call it.
              </Text>
            </span>
            <Text variant="body-sm" tone="secondary">
              {tool.policy.allowedAgents.length === 0 ? "Any granted" : tool.policy.allowedAgents.join(", ")}
            </Text>
          </li>
        </ul>
      </Section>

      <Section title="Agents holding a grant" help="Every agent permitted to call this tool. Each of them is a way it can be invoked.">
        {tool.usedByAgents.length === 0 ? (
          <Text variant="body-sm" tone="secondary">No agent has been granted this tool.</Text>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tool.usedByAgents.map((name) => (
              <li key={name} className="border-subtle text-fg-secondary font-ui rounded-xs border px-1.5 py-0.5 text-caption">
                {name}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function PolicyRow({
  label, help, expected, actual,
}: {
  label: string;
  help: string;
  expected: boolean;
  actual: boolean;
}) {
  const drift = expected && !actual;
  return (
    <li className="border-subtle flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0">
      <span className="min-w-0">
        <Text variant="body-sm" tone="primary" className="block">{label}</Text>
        <Text variant="caption" tone={drift ? "inherit" : "muted"} className={cn("block leading-snug", drift && "text-status-failed")}>
          {drift ? "The tier requires this, and it is switched off." : help}
        </Text>
      </span>
      <Switch checked={actual} onCheckedChange={() => {}} aria-label={label} />
    </li>
  );
}

/* ── Reliability ──────────────────────────────────────────────────────────── */

function Reliability({ tool }: { tool: ToolRecord }) {
  return (
    <>
      <Section title="Calls — 30 days" help="Volume and outcome.">
        <Facts
          items={[
            { label: "Calls", value: tool.calls30d.toLocaleString("en-GB") },
            { label: "Success rate", value: `${tool.successRate}%` },
            { label: "p95 latency", value: formatDuration(tool.p95LatencyMs) },
            { label: "Timeout", value: formatDuration(tool.timeoutMs) },
          ]}
        />
        {tool.p95LatencyMs > tool.timeoutMs * 0.7 ? (
          <Text variant="caption" tone="inherit" className="text-status-waiting mt-2 block leading-snug">
            p95 is within 30% of the timeout. A modest slowdown upstream will start turning slow calls
            into failed ones.
          </Text>
        ) : null}
      </Section>

      <Section title="Latency distribution" help="Where the calls actually land. A long tail matters more than the average.">
        <DistributionBar
          buckets={tool.latencyBuckets.map((b) => ({ label: `${b.upperMs}ms`, count: b.count }))}
          label="Latency distribution"
        />
      </Section>

      <Section title="Errors by class" help="Grouped by cause. One dominant class is a fix; five even ones is a dependency problem.">
        {tool.errorBreakdown.length === 0 ? (
          <Text variant="body-sm" tone="secondary">No errors recorded in the last 30 days.</Text>
        ) : (
          <ul className="grid gap-1.5">
            {tool.errorBreakdown.map((error) => (
              <li key={error.klass}>
                <span className="flex items-baseline justify-between gap-2">
                  <Text variant="body-sm" tone="secondary" className="min-w-0 truncate">{error.klass}</Text>
                  <Text variant="caption" tone="muted" tabular className="shrink-0">
                    {error.count} · {error.share}%
                  </Text>
                </span>
                <span className="bg-surface-active mt-1 block h-1 rounded-full">
                  <span className="bg-status-failed block h-1 rounded-full" style={{ width: `${error.share}%` }} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent failures" help="With links to the runs, because the run is where the cause is.">
        <ul className="grid gap-1">
          {tool.recentFailures.map((failure) => (
            <li key={failure.runId}>
              <Link
                href={`/runs/${failure.runId}` as Route}
                className={cn(
                  "-mx-1 block rounded-sm px-1 py-1",
                  "hover:bg-surface-hover transition-colors duration-fast outline-none focus-visible:focus-ring",
                )}
              >
                <Text variant="caption" tone="secondary" className="block break-words">{failure.message}</Text>
                <Text variant="caption" tone="disabled" className="font-code block truncate">{failure.runId}</Text>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/* ── Used by ──────────────────────────────────────────────────────────────── */

function UsedBy({ tool }: { tool: ToolRecord }) {
  return (
    <>
      <Section title="Workflow steps" help="Every step that calls this tool. A schema change breaks exactly these.">
        {tool.usedBy.length === 0 ? (
          <Text variant="body-sm" tone="secondary">
            No workflow calls this tool yet, so its schema is free to change.
          </Text>
        ) : (
          <ul className="grid gap-1">
            {tool.usedBy.map((ref) => (
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

      <Section title="Agents" help="Agents granted this tool may call it from any step they run in.">
        {tool.usedByAgents.length === 0 ? (
          <Text variant="body-sm" tone="secondary">No agent holds a grant for this tool.</Text>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tool.usedByAgents.map((name) => (
              <li key={name} className="border-subtle text-fg-secondary font-ui text-caption rounded-xs border px-1.5 py-0.5">
                {name}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/* ── Versions ─────────────────────────────────────────────────────────────── */

function Versions({ tool }: { tool: ToolRecord }) {
  return (
    <Section title="Schema history" help="Every change to what this tool accepts or returns.">
      <ol className="grid gap-2">
        {[...tool.versions].reverse().map((version) => (
          <li
            key={version.version}
            className={cn(
              "rounded-md border p-2.5",
              version.breaking ? "border-status-failed-border bg-status-failed-subtle" : "border-subtle",
            )}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <Text variant="body-sm" tone="primary" tabular>v{version.version}</Text>
              {version.breaking ? (
                <Text variant="caption" tone="inherit" className="text-status-failed">breaking</Text>
              ) : null}
              <Text variant="caption" tone="muted" className="ml-auto">{version.author}</Text>
            </div>
            <Text variant="body-sm" tone="secondary" className="mt-0.5 block">{version.summary}</Text>

            {version.breaking ? (
              <div className="mt-2">
                <Text variant="caption" tone="inherit" className="text-status-failed block">
                  {tool.usedBy.length} {tool.usedBy.length === 1 ? "step is" : "steps are"} bound to
                  the previous shape
                </Text>
                <ul className="mt-1 grid gap-0.5">
                  {version.breakingFields.map((field) => (
                    <li key={field}>
                      <code className="font-code text-mono-sm text-fg-secondary">{field}</code>
                    </li>
                  ))}
                </ul>
                {tool.usedBy.length > 0 ? (
                  <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
                    Affected: {tool.usedBy.map((r) => r.workflowName).join(", ")}. Each one needs its
                    binding re-pointed before this version is adopted.
                  </Text>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ── Test console ─────────────────────────────────────────────────────────── */

function TestConsole({ tool }: { tool: ToolRecord }) {
  const [values, setValues] = React.useState<Record<string, string>>(
    Object.fromEntries(tool.parameters.map((p) => [p.name, p.defaultValue ?? ""])),
  );
  const [result, setResult] = React.useState<{ ms: number; body: string } | null>(null);
  const [running, setRunning] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const curl = React.useMemo(() => {
    const body = JSON.stringify(values, null, 2);
    return `curl -X POST '${tool.endpoint.replace(/^POST\s+/, "")}' \\\n  -H 'Authorization: Bearer $VECTORBEA_TOKEN' \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}'`;
  }, [tool.endpoint, values]);

  const run = () => {
    setRunning(true);
    window.setTimeout(() => {
      setResult({
        ms: tool.p95LatencyMs,
        body: JSON.stringify(
          Object.fromEntries(tool.outputFields.map((f) => [f.name, f.type.startsWith("array") ? [] : f.type === "integer" ? 1 : "…"])),
          null, 2,
        ),
      });
      setRunning(false);
    }, 700);
  };

  return (
    <>
      <Section
        title="Parameters"
        help="Invokes the real tool through its real connection. Side effects are real — a write tool will write."
        tone={tool.risk === "critical" || tool.risk === "high" ? "warning" : undefined}
      >
        {tool.risk === "critical" || tool.risk === "high" ? (
          <Text variant="caption" tone="inherit" className="text-status-waiting mb-2 block leading-snug">
            This is a {tool.risk}-risk tool. Running it here performs the action for real, outside any
            approval gate a workflow would impose.
          </Text>
        ) : null}

        <div className="grid gap-2">
          {tool.parameters.map((p) => (
            <label key={p.name} className="grid gap-1">
              <span className="flex items-baseline gap-1.5">
                <Text variant="caption" tone="secondary">{p.name}</Text>
                {p.required ? <Text variant="caption" tone="inherit" className="text-status-failed">required</Text> : null}
              </span>
              <Input
                value={values[p.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
                placeholder={p.type}
                className="h-7 font-code text-mono-sm"
              />
            </label>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={run} loading={running}>
            {running ? "Calling" : "Call tool"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(curl);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              } catch {}
            }}
          >
            {copied ? "Copied" : "Copy as cURL"}
          </Button>
        </div>
      </Section>

      <Section title="Request" help="Exactly what would be sent.">
        <pre className="border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary max-h-48 overflow-auto rounded-sm border p-2">
          {curl}
        </pre>
      </Section>

      {result ? (
        <Section title="Response" help={`Returned in ${formatDuration(result.ms)}.`}>
          <pre className="border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary max-h-48 overflow-auto rounded-sm border p-2">
            {result.body}
          </pre>
        </Section>
      ) : null}
    </>
  );
}

export { TABS as TOOL_DETAIL_TABS };
