"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { NODE_MARKS } from "~/components/icons/nodes";
import {
  inputsFor, upstreamOf, flattenSchema, makeExpression, parseExpression,
  describeExpression, resolveExpression, checkType, typeOfField, evaluateTransform,
  formatResolved, TRANSFORM_FUNCTIONS, TYPE_LABEL, NULL_POLICY_LABEL, NULL_POLICY_HELP,
  type Binding, type FieldSchema, type InputDeclaration, type NullPolicy, type UpstreamNode,
} from "~/mocks/io-schema";
import type { BuilderEdge, BuilderNode } from "~/mocks/builder";
import type { VersionNode } from "~/mocks/workflow-nodes";

/* ══════════════════════════════════════════════════════════════════════════════
   INPUTS — the mapping interface.

   The docs promise "Unified I/O & mapping" and no screen has ever shown it.
   This is it: what this step needs on the left, everything upstream can supply
   on the right, and a binding between them.

   THE RESOLVED PREVIEW IS WHY THIS WORKS. Every mapping UI in this category
   shows you an expression and leaves you to imagine what it evaluates to;
   people then run the workflow to find out, which is a feedback loop measured
   in minutes and sometimes in sent emails. Resolving each binding against the
   last run's actual data collapses that loop to zero — you bind a field and
   immediately read `Northwind Trading Ltd`, not `{{ n1001.output.… }}`.

   That is also why a type mismatch here is a warning with a one-click coercion
   rather than a refusal: you can SEE the wrong value, so the UI does not need
   to be the thing that stops you.
══════════════════════════════════════════════════════════════════════════════ */

export interface InputsTabProps {
  node: VersionNode;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  bindings: Binding[];
  onChange: (bindings: Binding[]) => void;
  nullPolicies: Record<string, NullPolicy>;
  onNullPolicyChange: (inputId: string, policy: NullPolicy) => void;
  defaults: Record<string, unknown>;
  onDefaultChange: (inputId: string, value: unknown) => void;
  /** Wide layout: the tree sits beside the inputs rather than under them. */
  expanded: boolean;
}

export function InputsTab({
  node, nodes, edges, bindings, onChange,
  nullPolicies, onNullPolicyChange, defaults, onDefaultChange, expanded,
}: InputsTabProps) {
  const inputs = React.useMemo(() => inputsFor(node), [node]);
  const upstream = React.useMemo(() => upstreamOf(node.id, nodes, edges), [node.id, nodes, edges]);

  const [activeInput, setActiveInput] = React.useState<string | null>(inputs[0]?.id ?? null);
  const [dragField, setDragField] = React.useState<{ nodeId: string; path: string; type: string } | null>(null);
  const [dropTarget, setDropTarget] = React.useState<string | null>(null);

  React.useEffect(() => {
    setActiveInput((current) => (inputs.some((i) => i.id === current) ? current : inputs[0]?.id ?? null));
  }, [inputs]);

  const bindingFor = React.useCallback(
    (inputId: string) => bindings.find((b) => b.inputId === inputId) ?? null,
    [bindings],
  );

  const bind = React.useCallback((inputId: string, expression: string) => {
    const existing = bindings.find((b) => b.inputId === inputId);
    onChange(existing
      ? bindings.map((b) => (b.inputId === inputId ? { ...b, expression } : b))
      : [...bindings, { inputId, expression }]);
    setActiveInput(inputId);
  }, [bindings, onChange]);

  const unbind = React.useCallback((inputId: string) => {
    onChange(bindings.filter((b) => b.inputId !== inputId));
  }, [bindings, onChange]);

  const setTransform = React.useCallback((inputId: string, transform: string) => {
    onChange(bindings.map((b) => (b.inputId === inputId ? { ...b, transform } : b)));
  }, [bindings, onChange]);

  if (inputs.length === 0) {
    return (
      <div className="p-3">
        <Text variant="body-sm" tone="secondary" className="block">
          This step takes no inputs.
        </Text>
        <Text variant="caption" tone="muted" className="mt-1 block">
          A {node.kind} node is driven by its own configuration rather than by data from the steps
          above it. Everything it needs is on the Configure tab.
        </Text>
      </div>
    );
  }

  const unboundRequired = inputs.filter((i) => i.required && !bindingFor(i.id)).length;

  return (
    <div className={cn("grid min-h-0", expanded ? "grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" : "grid-rows-[auto_minmax(0,1fr)]")}>
      {/* ── Left: this node's inputs ─────────────────────────────────────── */}
      <div className="min-h-0 overflow-y-auto p-3">
        <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <Text variant="eyebrow" tone="muted">Inputs</Text>
          {unboundRequired > 0 ? (
            <Text variant="caption" tone="inherit" className="text-status-failed">
              {unboundRequired} required {unboundRequired === 1 ? "input is" : "inputs are"} unbound
            </Text>
          ) : (
            <Text variant="caption" tone="inherit" className="text-status-success">
              Every required input is bound
            </Text>
          )}
        </header>

        <ul className="grid gap-2">
          {inputs.map((input) => (
            <li key={input.id}>
              <InputRow
                input={input}
                binding={bindingFor(input.id)}
                upstream={upstream}
                active={activeInput === input.id}
                dropping={dropTarget === input.id}
                onActivate={() => setActiveInput(input.id)}
                onDropField={(field) => bind(input.id, makeExpression(field.nodeId, field.path))}
                onDragStateChange={setDropTarget}
                onUnbind={() => unbind(input.id)}
                onTransform={(t) => setTransform(input.id, t)}
                nullPolicy={nullPolicies[input.id] ?? input.nullPolicy}
                onNullPolicy={(p) => onNullPolicyChange(input.id, p)}
                defaultValue={defaults[input.id] ?? input.defaultValue}
                onDefault={(v) => onDefaultChange(input.id, v)}
                dragging={dragField !== null}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* ── Right: upstream output tree ──────────────────────────────────── */}
      <div className={cn("min-h-0 overflow-y-auto p-3", expanded ? "border-subtle border-l" : "border-subtle border-t")}>
        <UpstreamTree
          upstream={upstream}
          onDragField={setDragField}
          onPick={(nodeId, path) => {
            if (!activeInput) return;
            bind(activeInput, makeExpression(nodeId, path));
          }}
          activeInputLabel={inputs.find((i) => i.id === activeInput)?.label ?? null}
        />
      </div>
    </div>
  );
}

/* ── One input ────────────────────────────────────────────────────────────── */

function InputRow({
  input, binding, upstream, active, dropping, dragging,
  onActivate, onDropField, onDragStateChange, onUnbind, onTransform,
  nullPolicy, onNullPolicy, defaultValue, onDefault,
}: {
  input: InputDeclaration;
  binding: Binding | null;
  upstream: UpstreamNode[];
  active: boolean;
  dropping: boolean;
  dragging: boolean;
  onActivate: () => void;
  onDropField: (field: { nodeId: string; path: string }) => void;
  onDragStateChange: (id: string | null) => void;
  onUnbind: () => void;
  onTransform: (transform: string) => void;
  nullPolicy: NullPolicy;
  onNullPolicy: (policy: NullPolicy) => void;
  defaultValue: unknown;
  onDefault: (value: unknown) => void;
}) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const resolved = binding ? resolveExpression(binding.expression, upstream) : null;
  const fieldType = binding ? typeOfField(binding.expression, upstream) : null;
  const typeIssue = fieldType ? checkType(input.type, fieldType) : null;
  const label = binding ? describeExpression(binding.expression, upstream) : null;

  const transformed = binding?.transform && resolved?.found
    ? evaluateTransform(binding.transform, resolved.value)
    : null;

  const missing = input.required && !binding;

  return (
    <div
      onClick={onActivate}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "link"; onDragStateChange(input.id); }}
      onDragLeave={() => onDragStateChange(null)}
      onDrop={(e) => {
        e.preventDefault();
        onDragStateChange(null);
        const raw = e.dataTransfer.getData("application/vectorbea-field");
        if (!raw) return;
        try { onDropField(JSON.parse(raw)); } catch {}
      }}
      className={cn(
        "rounded-md border p-2.5 transition-colors duration-fast",
        dropping ? "border-accent bg-accent-subtle"
          : missing ? "border-status-failed-border bg-status-failed-subtle"
            : active ? "border-accent-border bg-surface-selected"
              : "border-subtle bg-surface-raised",
        // While a field is in flight every row advertises itself as a target;
        // a drop zone you cannot see is a drop zone you do not use.
        dragging && !dropping && "border-dashed",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Text variant="body-sm" tone="primary" className="font-medium">{input.label}</Text>
        <span className="border-subtle text-fg-muted font-code rounded-xs border px-1 text-[10px]">
          {TYPE_LABEL[input.type]}
        </span>
        {input.required ? (
          <Text variant="caption" tone="inherit" className="text-status-failed">required</Text>
        ) : (
          <Text variant="caption" tone="disabled">optional</Text>
        )}
      </div>

      {/* Helper text on every field — no field relies on its label alone. */}
      <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
        {input.description}
      </Text>

      {binding ? (
        <div className="mt-2 grid gap-1.5">
          {/* The binding chip: wire format and human label together. The
              expression is what runs; the label is what a reviewer reads. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <code className="font-code text-mono-sm border-accent-border bg-accent-subtle text-accent min-w-0 truncate rounded-xs border px-1.5 py-0.5">
              {binding.expression}
            </code>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUnbind(); }}
              aria-label={`Clear the binding on ${input.label}`}
              className={cn(
                "text-fg-disabled hover:text-status-failed grid size-4 shrink-0 place-items-center rounded-xs",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
              )}
            >
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
                <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {label ? <Text variant="caption" tone="secondary" className="block truncate">{label}</Text> : null}

          {/* ── THE RESOLVED PREVIEW ───────────────────────────────────── */}
          <div className="border-subtle bg-surface-sunken rounded-sm border px-2 py-1.5">
            <Text variant="caption" tone="muted" className="block">
              {resolved?.found ? "Resolves to, from the last run" : "No value in the last run"}
            </Text>
            <Text
              variant="mono-sm"
              tone={resolved?.found ? "primary" : "disabled"}
              className="mt-0.5 block break-words"
            >
              {resolved?.found ? formatResolved(resolved.value) : "This field was absent or the step never ran."}
            </Text>

            {transformed ? (
              <div className="border-subtle mt-1.5 border-t pt-1.5">
                <Text variant="caption" tone="muted" className="block">After the transform</Text>
                <Text
                  variant="mono-sm"
                  tone={transformed.error ? "inherit" : "primary"}
                  className={cn("mt-0.5 block break-words", transformed.error && "text-status-failed")}
                >
                  {transformed.error ?? formatResolved(transformed.value)}
                </Text>
              </div>
            ) : null}
          </div>

          {typeIssue ? (
            <div
              className={cn(
                "rounded-sm border px-2 py-1.5",
                typeIssue.severity === "error"
                  ? "border-status-failed-border bg-status-failed-subtle"
                  : "border-status-waiting-border bg-status-waiting-subtle",
              )}
            >
              <Text
                variant="caption"
                tone="inherit"
                className={typeIssue.severity === "error" ? "text-status-failed" : "text-status-waiting"}
              >
                {typeIssue.message}
              </Text>
              {typeIssue.coercion ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTransform(typeIssue.coercion!); setShowAdvanced(true); }}
                  className={cn(
                    "font-code text-mono-sm text-accent hover:text-accent-hover mt-1 block rounded-xs",
                    "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  )}
                >
                  Apply {typeIssue.coercion}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2">
          <Text variant="caption" tone={missing ? "inherit" : "muted"} className={missing ? "text-status-failed" : undefined}>
            {missing
              ? "Nothing bound. This is reported on the canvas node and blocks publishing."
              : "Nothing bound. Drag a field from the right, or pick this input and click a field."}
          </Text>
        </div>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setShowAdvanced((v) => !v); }}
        aria-expanded={showAdvanced}
        className={cn(
          "font-ui text-caption text-fg-muted hover:text-fg-primary mt-2 rounded-xs",
          "transition-colors duration-fast outline-none focus-visible:focus-ring",
        )}
      >
        {showAdvanced ? "Hide" : "Transform, default and null handling"}
      </button>

      {showAdvanced ? (
        <div className="border-subtle mt-2 grid gap-2 border-t pt-2" onClick={(e) => e.stopPropagation()}>
          <TransformEditor
            value={binding?.transform ?? ""}
            onChange={onTransform}
            disabled={!binding}
            sample={resolved?.value}
          />

          <label className="grid gap-1">
            <Text variant="caption" tone="secondary">Default value</Text>
            <Input
              value={defaultValue === undefined || defaultValue === null ? "" : String(defaultValue)}
              onChange={(e) => onDefault(e.target.value)}
              placeholder={input.required ? "Required inputs have no default" : "Used when nothing resolves"}
              disabled={input.required}
              className="h-7 text-body-sm"
            />
            <Text variant="caption" tone="muted">
              {input.required
                ? "A required input has no default — if it can be absent, it is not required."
                : "Substituted when the binding resolves to nothing and the policy below says to use it."}
            </Text>
          </label>

          <label className="grid gap-1">
            <Text variant="caption" tone="secondary">When the value is null</Text>
            <Select
              options={(Object.keys(NULL_POLICY_LABEL) as NullPolicy[]).map((p) => ({
                value: p, label: NULL_POLICY_LABEL[p],
              }))}
              value={nullPolicy}
              onValueChange={(v) => onNullPolicy(v as NullPolicy)}
              aria-label={`Null handling for ${input.label}`}
            />
            <Text variant="caption" tone="muted">{NULL_POLICY_HELP[nullPolicy]}</Text>
          </label>
        </div>
      ) : null}
    </div>
  );
}

/* ── Transform editor ─────────────────────────────────────────────────────── */

function TransformEditor({
  value, onChange, disabled, sample,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  sample: unknown;
}) {
  const [open, setOpen] = React.useState(false);
  const needle = value.trim().toLowerCase();

  const suggestions = React.useMemo(
    () => (needle
      ? TRANSFORM_FUNCTIONS.filter((f) => f.name.toLowerCase().includes(needle) || f.signature.toLowerCase().includes(needle))
      : TRANSFORM_FUNCTIONS
    ).slice(0, 6),
    [needle],
  );

  const preview = value.trim() ? evaluateTransform(value, sample) : null;

  return (
    <div className="relative grid gap-1">
      <Text variant="caption" tone="secondary">Transform</Text>
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        placeholder="money(value, 'GBP')"
        disabled={disabled}
        spellCheck={false}
        className="h-7 font-code text-mono-sm"
      />
      <Text variant="caption" tone="muted">
        Applied after the binding resolves. `value` is the resolved value.
      </Text>

      {preview ? (
        <div className="border-subtle bg-surface-sunken rounded-sm border px-2 py-1">
          <Text
            variant="mono-sm"
            tone={preview.error ? "inherit" : "primary"}
            className={cn("block break-words", preview.error && "text-status-failed")}
          >
            {preview.error ?? formatResolved(preview.value)}
          </Text>
        </div>
      ) : null}

      {open && !disabled && suggestions.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Transform functions"
          className={cn(
            "motion-overlay bg-surface-overlay border-subtle shadow-2 absolute left-0 right-0 top-full z-dropdown mt-1",
            "max-h-56 overflow-y-auto rounded-md border p-1",
          )}
        >
          {suggestions.map((fn) => (
            <li key={fn.name} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(fn.signature); setOpen(false); }}
                className="flex w-full flex-col rounded-xs px-2 py-1 text-left hover:bg-surface-hover"
              >
                <span className="font-code text-mono-sm text-accent">{fn.signature}</span>
                <span className="font-ui text-caption text-fg-muted">{fn.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── Upstream tree ────────────────────────────────────────────────────────── */

function UpstreamTree({
  upstream, onDragField, onPick, activeInputLabel,
}: {
  upstream: UpstreamNode[];
  onDragField: (field: { nodeId: string; path: string; type: string } | null) => void;
  onPick: (nodeId: string, path: string) => void;
  activeInputLabel: string | null;
}) {
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const needle = query.trim().toLowerCase();

  if (upstream.length === 0) {
    return (
      <>
        <Text variant="eyebrow" tone="muted" className="block">Available data</Text>
        <Text variant="body-sm" tone="secondary" className="mt-2 block">
          Nothing runs before this step.
        </Text>
        <Text variant="caption" tone="muted" className="mt-1 block">
          Connect it downstream of another node and that node&apos;s output appears here to bind from.
        </Text>
      </>
    );
  }

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <Text variant="eyebrow" tone="muted">Available data</Text>
        <Text variant="caption" tone="disabled">{upstream.length} upstream</Text>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search fields"
        aria-label="Search upstream fields"
        className="h-7 text-body-sm"
      />

      <Text variant="caption" tone="muted" className="mt-1.5 block">
        {activeInputLabel
          ? <>Click a field to bind it to <strong className="font-medium">{activeInputLabel}</strong>, or drag it onto any input.</>
          : "Drag a field onto an input to bind it."}
      </Text>

      <div className="mt-2 grid gap-2">
        {upstream.map((source) => {
          const fields = flattenSchema(source.fields).filter(
            (f) => !needle || f.path.toLowerCase().includes(needle) || f.description.toLowerCase().includes(needle),
          );
          if (fields.length === 0) return null;
          const isCollapsed = collapsed.has(source.id) && !needle;
          const entry = NODE_MARKS.find((m) => m.type === source.kind);
          const Icon = entry?.Icon;

          return (
            <section key={source.id} className="border-subtle rounded-md border">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(source.id)) next.delete(source.id);
                  else next.add(source.id);
                  return next;
                })}
                aria-expanded={!isCollapsed}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-t-md px-2 py-1.5 text-left",
                  "hover:bg-surface-hover transition-colors duration-fast",
                  "outline-none focus-visible:focus-ring",
                )}
              >
                <span className="border-subtle bg-surface-hover text-fg-secondary grid size-5 shrink-0 place-items-center rounded-xs border">
                  {Icon ? <Icon size={11} aria-hidden="true" /> : null}
                </span>
                <span className="font-ui text-body-sm text-fg-primary min-w-0 flex-1 truncate">{source.name}</span>
                {/* Distance, because binding almost always reaches one step back
                    and the nearest source is nearly always the right one. */}
                <span className="font-code text-fg-disabled shrink-0 text-[10px]">
                  {source.distance === 1 ? "1 step back" : `${source.distance} back`}
                </span>
              </button>

              {!isCollapsed ? (
                <ul className="border-subtle grid gap-px border-t p-1">
                  {fields.map((field) => (
                    <li key={field.path}>
                      <FieldRow
                        field={field}
                        nodeId={source.id}
                        onDragStart={() => onDragField({ nodeId: source.id, path: field.path, type: field.type })}
                        onDragEnd={() => onDragField(null)}
                        onPick={() => onPick(source.id, field.path)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}

function FieldRow({
  field, nodeId, onDragStart, onDragEnd, onPick,
}: {
  field: FieldSchema;
  nodeId: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onPick: () => void;
}) {
  const depth = (field.path.match(/[.[]/g) ?? []).length;

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/vectorbea-field",
          JSON.stringify({ nodeId, path: field.path, type: field.type }),
        );
        e.dataTransfer.effectAllowed = "link";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onPick}
      title={`${field.description}\n\n${makeExpression(nodeId, field.path)}`}
      className={cn(
        "flex w-full cursor-grab items-baseline gap-1.5 rounded-xs px-1.5 py-1 text-left",
        "hover:bg-surface-hover transition-colors duration-fast",
        "outline-none focus-visible:focus-ring active:cursor-grabbing",
      )}
      style={{ paddingLeft: 6 + depth * 10 }}
    >
      <span className="font-code text-mono-sm text-fg-primary min-w-0 flex-1 truncate">
        {field.path.split(/[.[]/).pop()?.replace(/\]$/, "") ?? field.path}
      </span>
      <span className="border-subtle text-fg-disabled font-code shrink-0 rounded-xs border px-1 text-[9px]">
        {TYPE_LABEL[field.type]}
      </span>
      {/* The sample value, inline. Choosing a field is much easier when you can
          see what it contained last time than when you can only read its name. */}
      {field.sample !== undefined && typeof field.sample !== "object" ? (
        <span className="font-code text-fg-muted max-w-[7rem] shrink-0 truncate text-[10px]">
          {String(field.sample)}
        </span>
      ) : null}
    </button>
  );
}

export { parseExpression };
