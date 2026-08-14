"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { formatCost, formatDuration } from "~/lib/format";
import {
  outputSchemaFor, flattenSchema, inputsFor, parseExpression, formatResolved,
  TYPE_LABEL, type Binding, type FieldSchema,
} from "~/mocks/io-schema";
import type { BuilderEdge, BuilderNode } from "~/mocks/builder";
import type { VersionNode } from "~/mocks/workflow-nodes";

/* ══════════════════════════════════════════════════════════════════════════════
   OUTPUT and TEST.

   THE REVERSE INDEX IS THE POINT OF THE OUTPUT TAB. A schema you can edit
   without knowing who reads it is a schema you will break. Listing which
   downstream steps consume which field turns "rename this" from a guess into a
   decision — and the fields with consumers are exactly the ones worth being
   careful about.

   THE TEST TAB DIFFS AGAINST THE LAST REAL EXECUTION. A response on its own
   tells you the call worked. A response beside the last real one tells you
   whether it worked THE SAME WAY, which is the question being asked by anybody
   who opens this tab after changing a binding.
══════════════════════════════════════════════════════════════════════════════ */

/* ── Output ───────────────────────────────────────────────────────────────── */

export interface Consumer {
  nodeId: string;
  nodeName: string;
  inputLabel: string;
  path: string;
}

/** Which downstream steps read which of this node's fields. */
export function consumersOf(
  nodeId: string,
  nodes: BuilderNode[],
  edges: BuilderEdge[],
  bindingsByNode: Record<string, Binding[]>,
): Consumer[] {
  // Downstream set first, so a node that merely mentions the id in a comment
  // is not counted as a consumer.
  const downstream = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === id && !downstream.has(edge.target)) {
        downstream.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  const out: Consumer[] = [];
  for (const id of downstream) {
    const node = nodes.find((n) => n.node.id === id);
    if (!node) continue;
    const declarations = inputsFor(node.node);
    for (const binding of bindingsByNode[id] ?? []) {
      const parsed = parseExpression(binding.expression);
      if (!parsed || parsed.nodeId !== nodeId) continue;
      out.push({
        nodeId: id,
        nodeName: node.node.name,
        inputLabel: declarations.find((d) => d.id === binding.inputId)?.label ?? binding.inputId,
        path: parsed.path,
      });
    }
  }
  return out;
}

export function OutputTab({
  node, nodes, edges, bindingsByNode,
}: {
  node: VersionNode;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  bindingsByNode: Record<string, Binding[]>;
}) {
  const schema = React.useMemo(() => outputSchemaFor(node), [node]);
  const flat = React.useMemo(() => flattenSchema(schema), [schema]);
  const consumers = React.useMemo(
    () => consumersOf(node.id, nodes, edges, bindingsByNode),
    [node.id, nodes, edges, bindingsByNode],
  );

  const byPath = React.useMemo(() => {
    const map = new Map<string, Consumer[]>();
    for (const c of consumers) map.set(c.path, [...(map.get(c.path) ?? []), c]);
    return map;
  }, [consumers]);

  return (
    <div className="grid gap-4 p-3">
      <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
        <Text variant="label" tone="primary" className="block">Declared schema</Text>
        <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">
          Inferred from the step type and its binding. Editable — but the consumers listed against
          each field are what break if you change its name or type.
        </Text>

        <ul className="grid gap-px">
          {flat.map((field) => (
            <OutputField key={field.path} field={field} consumers={byPath.get(field.path) ?? []} />
          ))}
        </ul>
      </section>

      <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
        <Text variant="label" tone="primary" className="block">Sample from the last run</Text>
        <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">
          What this step actually emitted, most recently.
        </Text>
        <pre className="border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary max-h-56 overflow-auto rounded-sm border p-2">
          {JSON.stringify(
            Object.fromEntries(schema.map((f) => [f.path, f.sample])),
            null,
            2,
          )}
        </pre>
      </section>

      <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
        <Text variant="label" tone="primary" className="block">Consumed by</Text>
        <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">
          Every downstream input bound to this step. This is what you check before changing a name.
        </Text>

        {consumers.length === 0 ? (
          <Text variant="body-sm" tone="secondary">
            Nothing downstream reads this step&apos;s output yet, so its schema is free to change.
          </Text>
        ) : (
          <ul className="grid gap-1">
            {consumers.map((c, i) => (
              <li key={`${c.nodeId}-${c.path}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5">
                <Text variant="body-sm" tone="primary">{c.nodeName}</Text>
                <Text variant="caption" tone="muted">reads</Text>
                <code className="font-code text-mono-sm text-accent">{c.path}</code>
                <Text variant="caption" tone="muted">into {c.inputLabel}</Text>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OutputField({ field, consumers }: { field: FieldSchema; consumers: Consumer[] }) {
  const depth = (field.path.match(/[.[]/g) ?? []).length;
  return (
    <li
      className="flex items-baseline gap-1.5 rounded-xs px-1.5 py-1"
      style={{ paddingLeft: 6 + depth * 10 }}
    >
      <code className="font-code text-mono-sm text-fg-primary min-w-0 flex-1 truncate">{field.path}</code>
      <span className="border-subtle text-fg-muted font-code shrink-0 rounded-xs border px-1 text-[9px]">
        {TYPE_LABEL[field.type]}
      </span>
      {consumers.length > 0 ? (
        <span
          className="border-accent-border bg-accent-subtle text-accent font-code shrink-0 rounded-xs border px-1 text-[9px]"
          title={consumers.map((c) => `${c.nodeName} → ${c.inputLabel}`).join("\n")}
        >
          {consumers.length} consumer{consumers.length === 1 ? "" : "s"}
        </span>
      ) : null}
    </li>
  );
}

/* ── Test ─────────────────────────────────────────────────────────────────── */

interface TestResult {
  durationMs: number;
  tokens: number;
  costUsd: number;
  request: unknown;
  response: unknown;
}

export function TestTab({
  node, bindings,
}: {
  node: VersionNode;
  bindings: Binding[];
}) {
  const inputs = React.useMemo(() => inputsFor(node), [node]);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<TestResult | null>(null);
  const [running, setRunning] = React.useState(false);

  const schema = React.useMemo(() => outputSchemaFor(node), [node]);

  // The last real execution, to diff against.
  const lastReal = React.useMemo<TestResult>(() => ({
    durationMs: 1840,
    tokens: 1204,
    costUsd: 0.0031,
    request: Object.fromEntries(inputs.map((i) => [i.id, "(from the last run)"])),
    response: Object.fromEntries(schema.map((f) => [f.path, f.sample])),
  }), [inputs, schema]);

  const run = () => {
    setRunning(true);
    window.setTimeout(() => {
      setResult({
        durationMs: 1620,
        tokens: 1188,
        costUsd: 0.0029,
        request: Object.fromEntries(
          inputs.map((i) => [i.id, values[i.id] ?? bindings.find((b) => b.inputId === i.id)?.expression ?? null]),
        ),
        response: Object.fromEntries(schema.map((f) => [f.path, f.sample])),
      });
      setRunning(false);
    }, 900);
  };

  return (
    <div className="grid gap-4 p-3">
      <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
        <Text variant="label" tone="primary" className="block">Inputs for this test</Text>
        <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">
          Pre-filled from the bindings. Edit any of them to try a different case without touching the
          workflow.
        </Text>

        {inputs.length === 0 ? (
          <Text variant="body-sm" tone="secondary">This step takes no inputs.</Text>
        ) : (
          <div className="grid gap-2">
            {inputs.map((input) => (
              <label key={input.id} className="grid gap-1">
                <Text variant="caption" tone="secondary">{input.label}</Text>
                <Input
                  value={values[input.id] ?? bindings.find((b) => b.inputId === input.id)?.expression ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [input.id]: e.target.value }))}
                  placeholder={input.required ? "Required" : "Optional"}
                  className="h-7 font-code text-mono-sm"
                />
              </label>
            ))}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={run} loading={running}>
            {running ? "Running" : "Run this step"}
          </Button>
          {running ? <Spinner className="size-4" /> : null}
          <Text variant="caption" tone="muted">
            Runs against real connections. Side effects are real.
          </Text>
        </div>
      </section>

      {result ? (
        <>
          <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
            <Text variant="label" tone="primary" className="block">Result</Text>
            <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              <Metric label="Duration" value={formatDuration(result.durationMs)} delta={result.durationMs - lastReal.durationMs} format={(d) => `${d > 0 ? "+" : "−"}${formatDuration(Math.abs(d))}`} lowerIsBetter />
              <Metric label="Tokens" value={String(result.tokens)} delta={result.tokens - lastReal.tokens} format={(d) => `${d > 0 ? "+" : "−"}${Math.abs(d)}`} lowerIsBetter />
              <Metric label="Cost" value={formatCost(result.costUsd)} delta={result.costUsd - lastReal.costUsd} format={(d) => `${d > 0 ? "+" : "−"}${formatCost(Math.abs(d))}`} lowerIsBetter />
            </dl>
            <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
              Compared with the last real execution of this step, not with the previous test — a test
              against a test tells you nothing about production.
            </Text>
          </section>

          <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
            <Text variant="label" tone="primary" className="block">Request</Text>
            <pre className="border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary mt-2 max-h-40 overflow-auto rounded-sm border p-2">
              {JSON.stringify(result.request, null, 2)}
            </pre>
          </section>

          <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
            <Text variant="label" tone="primary" className="block">Response</Text>
            <pre className="border-subtle bg-surface-sunken font-code text-mono-sm text-fg-secondary mt-2 max-h-56 overflow-auto rounded-sm border p-2">
              {JSON.stringify(result.response, null, 2)}
            </pre>
            <Text variant="caption" tone="inherit" className="text-status-success mt-2 block">
              Shape matches the last real execution — every declared field is present with the same type.
            </Text>
          </section>
        </>
      ) : (
        <section className="border-subtle rounded-md border border-dashed p-3 text-center">
          <Text variant="body-sm" tone="secondary" className="block">Not run yet</Text>
          <Text variant="caption" tone="muted" className="mt-1 block">
            Running one step in isolation is the fastest way to find out whether a binding is right,
            without waiting for the whole workflow.
          </Text>
        </section>
      )}
    </div>
  );
}

function Metric({
  label, value, delta, format, lowerIsBetter,
}: {
  label: string;
  value: string;
  delta: number;
  format: (d: number) => string;
  lowerIsBetter: boolean;
}) {
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  const same = Math.abs(delta) < 1e-9;
  return (
    <div>
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd className="flex items-baseline gap-1.5">
        <Text variant="body-sm" tone="primary" tabular>{value}</Text>
        {same ? (
          <Text variant="caption" tone="disabled">no change</Text>
        ) : (
          <Text
            variant="caption"
            tone="inherit"
            tabular
            className={better ? "text-status-success" : "text-status-waiting"}
          >
            {format(delta)}
          </Text>
        )}
      </dd>
    </div>
  );
}

export { formatResolved };
