"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { NODE_MARKS } from "~/components/icons/nodes";
import { useBuilderRegistry } from "../use-builder-registry";
import {
  stepInputs, sourceSteps, suggestFor, parseStepRef, stepRef, readInputMapping,
  takesCustomInputs, inputNameFor, VALUE_KIND_LABEL,
  type SourceStep, type StepInput, type StepRef,
} from "../step-io";
import type { BuilderEdge, BuilderNode } from "~/lib/workflows/builder-graph";
import type { VersionNode } from "~/mocks/workflow-nodes";

/* ══════════════════════════════════════════════════════════════════════════════
   INPUTS — what this step receives.

   Each input takes either a value typed here or a field from an earlier step,
   picked from a list by name. There is no expression to write: the stored form
   (`{{ steps.<id>.output.<field> }}`, see step-io.ts) is what the worker reads,
   and the screen shows "Find changes › Changes" instead.

   Two conveniences carry most of the work. An input whose name matches a field
   an earlier step produces is offered that field in one click, and all of them
   at once from the top. And a step that takes named data — an agent — lists the
   earlier fields it does not receive yet, so passing one along is one click
   rather than naming an input and then finding its source.
══════════════════════════════════════════════════════════════════════════════ */

export interface InputsTabProps {
  node: VersionNode;
  nodes: BuilderNode[];
  edges: BuilderEdge[];
  onChange: (mapping: Record<string, string>) => void;
}

export function InputsTab({ node, nodes, edges, onChange }: InputsTabProps) {
  const registry = useBuilderRegistry();
  const mapping = React.useMemo(() => readInputMapping(node.config), [node.config]);
  const inputs = React.useMemo(() => stepInputs(node, registry), [node, registry]);
  const sources = React.useMemo(() => sourceSteps(node.id, nodes, edges, registry), [node.id, nodes, edges, registry]);
  const custom = takesCustomInputs(node);

  const setValue = (id: string, value: string, keepEmpty: boolean) => {
    const next = { ...mapping };
    if (value === "" && !keepEmpty) delete next[id];
    else next[id] = value;
    onChange(next);
  };
  const remove = (id: string) => {
    const next = { ...mapping };
    delete next[id];
    onChange(next);
  };

  const suggestions = inputs
    .filter((input) => !mapping[input.id]?.trim())
    .map((input) => ({ input, suggestion: suggestFor(input.id, sources) }))
    .filter((entry): entry is { input: StepInput; suggestion: NonNullable<ReturnType<typeof suggestFor>> } => entry.suggestion !== null);

  const fillAll = () => {
    const next = { ...mapping };
    for (const { input, suggestion } of suggestions) next[input.id] = stepRef(suggestion.nodeId, suggestion.path);
    onChange(next);
  };

  if (!custom) {
    return (
      <div className="p-3">
        <Text variant="body-sm" tone="secondary" className="block">This step doesn&apos;t take inputs.</Text>
      </div>
    );
  }

  if (node.kind === "tool" && inputs.length === 0 && Object.keys(mapping).length === 0 && !node.config.toolId && !node.config.tool) {
    return (
      <div className="p-3">
        <Text variant="body-sm" tone="secondary" className="block">Pick a tool on Configure first.</Text>
      </div>
    );
  }

  return (
    <div className="grid gap-3 p-3">
      {suggestions.length > 0 ? (
        <div className="border-accent-border bg-accent-subtle flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-2">
          <Text variant="caption" tone="secondary">
            {suggestions.length === 1
              ? `1 input matches a field from an earlier step.`
              : `${suggestions.length} inputs match fields from earlier steps.`}
          </Text>
          <Button size="xs" variant="secondary" onClick={fillAll}>Fill in</Button>
        </div>
      ) : null}

      {inputs.length === 0 ? (
        <Text variant="caption" tone="muted" className="block">
          {sources.length > 0
            ? "Nothing is passed to this step yet. Add data from an earlier step below."
            : "Nothing is passed to this step yet."}
        </Text>
      ) : (
        <ul className="grid gap-2">
          {inputs.map((input) => (
            <li key={input.id}>
              <InputCard
                input={input}
                value={mapping[input.id] ?? ""}
                nodes={nodes}
                sources={sources}
                onValue={(value) => setValue(input.id, value, input.custom)}
                onRemove={input.custom ? () => remove(input.id) : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Extra named inputs on a tool are how a step gets a value to test in
          Advanced → Skip if (`input.count == 0`), which reads this step's inputs. */}
      <AddInputs
        mapping={mapping}
        nodes={nodes}
        sources={sources}
        onChange={onChange}
        note={node.kind === "tool" && inputs.some((input) => !input.custom)
          ? "Extra inputs are sent to the tool too. Use them for Skip if on Advanced."
          : null}
      />
    </div>
  );
}

/* ── One input ────────────────────────────────────────────────────────────── */

function InputCard({
  input, value, nodes, sources, onValue, onRemove,
}: {
  input: StepInput;
  value: string;
  nodes: BuilderNode[];
  sources: SourceStep[];
  onValue: (value: string) => void;
  onRemove?: () => void;
}) {
  const [picking, setPicking] = React.useState(false);
  const ref = value ? parseStepRef(value, nodes) : null;
  const refSource = ref ? sources.find((s) => s.id === ref.nodeId) ?? null : null;
  const refName = ref ? nodes.find((n) => n.node.id === ref.nodeId)?.node.name ?? "A removed step" : null;
  const refLabel = ref ? refSource?.fields.find((f) => f.path === ref.path)?.label ?? ref.path : null;
  const suggestion = !value.trim() ? suggestFor(input.id, sources) : null;
  const missing = input.required && !value.trim();

  return (
    <div
      className={cn(
        "rounded-md border p-2.5",
        missing ? "border-status-failed-border" : "border-subtle",
        "bg-surface-raised",
      )}
    >
      <div className="flex items-baseline gap-2">
        <Text variant="body-sm" tone="primary" className="min-w-0 flex-1 truncate font-medium">{input.label}</Text>
        {missing ? (
          <Text variant="caption" tone="inherit" className="text-status-failed shrink-0">Required</Text>
        ) : !input.required && !input.custom ? (
          <Text variant="caption" tone="disabled" className="shrink-0">Optional</Text>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${input.label}`}
            className={cn(
              "text-fg-disabled hover:text-status-failed grid size-5 shrink-0 place-items-center rounded-xs",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            <CrossGlyph />
          </button>
        ) : null}
      </div>
      {input.help ? (
        <Text variant="caption" tone="muted" className="mt-0.5 line-clamp-2 block leading-snug">{input.help}</Text>
      ) : null}

      <div className="mt-2">
        {ref ? (
          <div className="border-accent-border bg-accent-subtle flex min-w-0 items-center gap-1.5 rounded-sm border px-2 py-1">
            <StepMark kind={refSource?.kind ?? nodes.find((n) => n.node.id === ref.nodeId)?.node.kind} />
            <Text variant="body-sm" tone="primary" className="min-w-0 flex-1 truncate">
              {refName} <span className="text-fg-muted">›</span> {refLabel}
            </Text>
            <Button size="xs" variant="ghost" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>Change</Button>
            <button
              type="button"
              onClick={() => onValue("")}
              aria-label={`Clear ${input.label}`}
              className={cn(
                "text-fg-muted hover:text-status-failed grid size-5 shrink-0 place-items-center rounded-xs",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
              )}
            >
              <CrossGlyph />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Input
              value={value}
              onChange={(e) => onValue(e.target.value)}
              placeholder={sources.length > 0 ? "Type a value or pick from a step" : "Type a value"}
              aria-label={input.label}
              className="h-8 min-w-0 flex-1 text-body-sm"
            />
            {sources.length > 0 ? (
              <Button size="xs" variant="secondary" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
                From a step
              </Button>
            ) : null}
          </div>
        )}

        {suggestion && !picking ? (
          <button
            type="button"
            onClick={() => onValue(stepRef(suggestion.nodeId, suggestion.path))}
            className={cn(
              "font-ui text-caption text-accent hover:text-accent-hover mt-1.5 block rounded-xs text-left",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
            )}
          >
            Use {suggestion.stepName} › {suggestion.label}
          </button>
        ) : null}

        {picking ? (
          <FieldPicker
            sources={sources}
            selected={ref}
            onPick={(nodeId, path) => { onValue(stepRef(nodeId, path)); setPicking(false); }}
            onClose={() => setPicking(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ── Picking a field from an earlier step ─────────────────────────────────── */

function FieldPicker({
  sources, selected, onPick, onClose,
}: {
  sources: SourceStep[];
  selected: StepRef | null;
  onPick: (nodeId: string, path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();
  const total = sources.reduce((sum, s) => sum + s.fields.length, 0);

  return (
    <div
      className="border-subtle bg-surface-overlay shadow-2 mt-1.5 grid gap-1.5 rounded-md border p-1.5"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
    >
      {total > 8 ? (
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search fields from earlier steps"
          className="h-7 text-body-sm"
          autoFocus
        />
      ) : null}
      <div className="grid max-h-64 gap-1.5 overflow-y-auto">
        {sources.map((source) => {
          const fields = source.fields.filter((f) =>
            !needle || f.label.toLowerCase().includes(needle) || f.path.toLowerCase().includes(needle)
            || source.name.toLowerCase().includes(needle));
          if (fields.length === 0) return null;
          return (
            <section key={source.id}>
              <div className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1">
                <StepMark kind={source.kind} />
                <Text variant="caption" tone="secondary" className="truncate font-medium">{source.name}</Text>
              </div>
              <ul role="listbox" aria-label={`Fields from ${source.name}`}>
                {fields.map((field) => {
                  const active = selected?.nodeId === source.id && selected.path === field.path;
                  return (
                    <li key={field.path} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onClick={() => onPick(source.id, field.path)}
                        title={field.help ?? undefined}
                        className={cn(
                          "flex w-full items-baseline gap-2 rounded-xs px-2 py-1 text-left",
                          "transition-colors duration-fast outline-none focus-visible:focus-ring",
                          active ? "bg-surface-selected" : "hover:bg-surface-hover",
                        )}
                      >
                        <span className="font-ui text-body-sm text-fg-primary min-w-0 flex-1 truncate">{field.label}</span>
                        <span className="font-ui text-caption text-fg-disabled shrink-0">{VALUE_KIND_LABEL[field.kind]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ── Adding inputs to a step that takes named data ────────────────────────── */

function AddInputs({
  mapping, nodes, sources, onChange, note,
}: {
  mapping: Record<string, string>;
  nodes: BuilderNode[];
  sources: SourceStep[];
  onChange: (mapping: Record<string, string>) => void;
  note: string | null;
}) {
  const [name, setName] = React.useState("");

  /* Fields already passed in, so they are not offered twice. */
  const used = new Set(
    Object.values(mapping)
      .map((value) => parseStepRef(value, nodes))
      .filter((ref): ref is StepRef => ref !== null)
      .map((ref) => `${ref.nodeId}:${ref.path}`),
  );
  const offers = sources
    .flatMap((source) => source.fields.map((field) => ({ source, field })))
    .filter(({ source, field }) => !used.has(`${source.id}:${field.path}`))
    .slice(0, 12);

  const uniqueName = (base: string) => {
    let candidate = base;
    let n = 2;
    while (candidate in mapping) candidate = `${base}${n++}`;
    return candidate;
  };

  const addFrom = (source: SourceStep, path: string) => {
    /* A full reply is named after the step it came from — "content" twice over
       tells the agent nothing about which is which. */
    const base = path === "content" ? camelName(source.name) || "reply" : inputNameFor(path);
    onChange({ ...mapping, [uniqueName(base)]: stepRef(source.id, path) });
  };

  const addNamed = () => {
    const trimmed = name.trim().replace(/\s+/g, "_");
    if (!trimmed) return;
    onChange({ ...mapping, [uniqueName(trimmed)]: "" });
    setName("");
  };

  return (
    <div className="border-subtle grid gap-2 border-t pt-3">
      {offers.length > 0 ? (
        <>
          <Text variant="caption" tone="secondary" className="block font-medium">Pass data from earlier steps</Text>
          <div className="flex flex-wrap gap-1.5">
            {offers.map(({ source, field }) => (
              <button
                key={`${source.id}:${field.path}`}
                type="button"
                onClick={() => addFrom(source, field.path)}
                title={field.help ?? undefined}
                className={cn(
                  "border-subtle bg-surface-raised hover:border-strong hover:bg-surface-hover flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5",
                  "transition-colors duration-fast outline-none focus-visible:focus-ring",
                )}
              >
                <span className="text-accent font-ui text-caption" aria-hidden="true">+</span>
                <span className="font-ui text-caption text-fg-primary truncate">{field.label}</span>
                <span className="font-ui text-caption text-fg-disabled truncate">· {source.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {note ? <Text variant="caption" tone="muted" className="block">{note}</Text> : null}

      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => { e.preventDefault(); addNamed(); }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add an input by name"
          aria-label="New input name"
          className="h-8 min-w-0 flex-1 text-body-sm"
        />
        <Button size="xs" variant="secondary" type="submit" disabled={!name.trim()}>Add</Button>
      </form>
    </div>
  );
}

/** "Find changes" → "findChanges". */
function camelName(value: string): string {
  const words = value.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join("");
}

/* ── Glyphs ───────────────────────────────────────────────────────────────── */

function StepMark({ kind }: { kind: string | undefined }) {
  const Icon = NODE_MARKS.find((m) => m.type === kind)?.Icon;
  return (
    <span className="border-subtle bg-surface-hover text-fg-secondary grid size-4 shrink-0 place-items-center rounded-xs border" aria-hidden="true">
      {Icon ? <Icon size={10} aria-hidden="true" /> : null}
    </span>
  );
}

function CrossGlyph() {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden="true">
      <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}
