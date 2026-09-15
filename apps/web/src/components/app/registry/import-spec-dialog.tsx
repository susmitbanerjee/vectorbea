"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CloudArrowDown, FileArrowUp, MagnifyingGlass, CheckCircle, WarningCircle,
  ArrowRight, ArrowLeft, GitDiff, LockKey,
} from "@phosphor-icons/react/dist/ssr";
import type { contracts } from "@vectorbea/shared";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/choice";
import {
  Modal, ModalBody, ModalFooter, ModalHeader, ModalNote, ModalSection, ModalStepBar,
  type ModalStep,
} from "~/components/ui/modal";
import { useApi } from "~/lib/api/api-provider";
import { useApiMutation, useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { ConnectionPicker } from "./create-atoms";

/* ══════════════════════════════════════════════════════════════════════════════
   IMPORT AN API DOCUMENT

   ── WHY THIS IS THREE STEPS AND NOT ONE BUTTON ──────────────────────────────
   GitHub's OpenAPI document describes about nine hundred operations. A customer
   importing it wants four. An import that created a tool per operation would
   have made the registry unusable in one click, and there is no undo that puts
   that right — so importing PARSES and creates nothing, and a second, explicit
   action creates the tools somebody chose.

   ── THE CREDENTIAL IS ASKED FOR ONCE ────────────────────────────────────────
   A document states exactly how to authenticate, including the header NAME —
   which is the fact the previous resolver could not act on, because it always
   sent `x-api-key`. The import reads the scheme, names it in the operator's
   terms, and binds the whole import to one connection. Prompting per operation
   would make importing forty tools a forty-step credential wizard.

   ── A RE-IMPORT SHOWS A DIFF AND CHANGES NOTHING ────────────────────────────
   `agents.allowedToolIds` grants a tool by id. If a re-import rewrote tools in
   place, an agent granted a narrowly-scoped tool could be regranted a wider one
   by somebody pasting a URL. So a re-import writes pending versions and this
   dialog shows what changed, with the ones an agent currently holds first.
══════════════════════════════════════════════════════════════════════════════ */

type Step = "source" | "auth" | "operations" | "done";

const STEPS: ModalStep[] = [
  { id: "source", label: "Document", summary: "Where the API is described" },
  { id: "auth", label: "Credential", summary: "What it needs to authenticate" },
  { id: "operations", label: "Operations", summary: "Which calls become tools" },
  { id: "done", label: "Done", summary: "What was created" },
];

export function ImportSpecDialog({
  open, onOpenChange, onImported, presetConnectionId,
}: {
  open: boolean;
  presetConnectionId?: string | null;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
}) {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();

  const [step, setStep] = React.useState<Step>("source");
  const [mode, setMode] = React.useState<"url" | "upload">("url");
  const [url, setUrl] = React.useState("");
  const [document, setDocument] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [connectionId, setConnectionId] = React.useState<string | null>(presetConnectionId ?? null);
  const [result, setResult] = React.useState<contracts.SpecImportResult | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState("");
  const [tag, setTag] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<contracts.SpecToolsCreated | null>(null);

  /* Only while the dialog is open: a connection list is a request, and a closed
     dialog making one on every tools-page render is a request per render. */
  const connections = useApiQuery({
    queryKey: queryKeys.connections.list(scope, { type: "http" }),
    queryFn: () => api.connections.list({ ...scope, pageSize: 100 }, undefined),
    enabled: open,
    freshness: "list",
  });

  const reset = React.useCallback(() => {
    setStep("source"); setMode("url"); setUrl(""); setDocument(""); setFileName(null);
    setConnectionId(null); setResult(null); setSelected(new Set()); setSearch("");
    setTag(null); setCreated(null);
  }, []);

  const importSpec = useApiMutation({
    mutationFn: () =>
      api.toolSpecs.import(
        {
          url: mode === "url" ? url.trim() : undefined,
          document: mode === "upload" ? document : undefined,
          connectionId,
        },
        scope,
      ),
    onSuccess: (data) => {
      setResult(data);
      /* Straight past the credential step when the document says it needs none —
         asking for a key an API does not read is a step that teaches the wrong
         thing about the API. */
      setStep(data.auth.length === 0 ? "operations" : "auth");
    },
  });

  const createTools = useApiMutation({
    mutationFn: () =>
      api.toolSpecs.createTools(
        result!.import.id,
        { operationKeys: Array.from(selected), connectionId },
        scope,
      ),
    onSuccess: (data) => {
      setCreated(data);
      setStep("done");
      void queryClient.invalidateQueries({ queryKey: queryKeys.tools.all(scope) });
      onImported?.();
    },
  });

  /* Memoised, not inlined: `result?.operations ?? []` is a NEW array on every
     render when `result` is null, which would re-run both memos below on every
     keystroke in the filter box — over nine hundred operations, on GitHub. */
  const operations = React.useMemo(() => result?.operations ?? [], [result]);
  const tags = React.useMemo(
    () => Array.from(new Set(operations.flatMap((o: contracts.SpecOperation) => o.tags))).sort(),
    [operations],
  );
  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return operations.filter((op: contracts.SpecOperation) =>
      (!tag || op.tags.includes(tag)) &&
      (!q || op.path.toLowerCase().includes(q) ||
        (op.summary ?? "").toLowerCase().includes(q) ||
        op.operationKey.toLowerCase().includes(q)),
    );
  }, [operations, search, tag]);

  const sourceReady = mode === "url" ? url.trim().length > 8 : document.length > 0;
  const activeIndex = STEPS.findIndex((s) => s.id === step);

  const close = () => { onOpenChange(false); window.setTimeout(reset, 200); };

  return (
    <Modal open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())} size="xl">
      <ModalHeader
        eyebrow="Build · Tools"
        title="Import an API document"
        description="One OpenAPI or Postman document becomes many tools, with their parameters, bodies, auth and response shapes already correct."
        closeDisabled={importSpec.isPending || createTools.isPending}
      />
      {/* Steps are not clickable backwards: each one narrows the next, and jumping
          back to the document after choosing operations would leave a selection
          that refers to a document nobody has re-read. Back is an explicit button. */}
      <ModalStepBar
        steps={STEPS}
        activeIndex={activeIndex}
        reachableIndex={activeIndex}
        onSelect={() => undefined}
      />

      <ModalBody>
        {step === "source" ? (
          <SourceStep
            mode={mode} setMode={setMode}
            url={url} setUrl={setUrl}
            fileName={fileName}
            onFile={(name, text) => { setFileName(name); setDocument(text); }}
            error={importSpec.error?.message}
          />
        ) : null}

        {step === "auth" && result ? (
          <AuthStep
            candidates={result.auth}
            notes={result.notes}
            connections={connections.data?.items ?? []}
            connectionId={connectionId}
            onConnectionChange={setConnectionId}
          />
        ) : null}

        {step === "operations" && result ? (
          <OperationsStep
            result={result}
            visible={visible}
            tags={tags}
            tag={tag} setTag={setTag}
            search={search} setSearch={setSearch}
            selected={selected} setSelected={setSelected}
            error={createTools.error?.message}
          />
        ) : null}

        {step === "done" && created ? <DoneStep created={created} /> : null}
      </ModalBody>

      <ModalFooter
        hint={
          step === "operations" && result
            ? `${selected.size} of ${result.import.operationCount} selected`
            : step === "source"
              ? "The document is fetched and parsed on the server. Nothing is created yet."
              : undefined
        }
      >
        {step === "source" ? (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              iconRight={<Icon icon={ArrowRight} size="sm" decorative />}
              disabled={!sourceReady || importSpec.isPending}
              loading={importSpec.isPending}
              onClick={() => importSpec.mutate()}
            >
              Read the document
            </Button>
          </>
        ) : null}

        {step === "auth" ? (
          <>
            <Button variant="ghost" iconLeft={<Icon icon={ArrowLeft} size="sm" decorative />} onClick={() => setStep("source")}>Back</Button>
            <Button
              variant="primary"
              iconRight={<Icon icon={ArrowRight} size="sm" decorative />}
              disabled={!connectionId}
              onClick={() => setStep("operations")}
            >
              Choose operations
            </Button>
          </>
        ) : null}

        {step === "operations" ? (
          <>
            <Button
              variant="ghost" iconLeft={<Icon icon={ArrowLeft} size="sm" decorative />}
              onClick={() => setStep(result?.auth.length ? "auth" : "source")}
            >
              Back
            </Button>
            <Button
              variant="primary"
              disabled={selected.size === 0 || !connectionId || createTools.isPending}
              loading={createTools.isPending}
              onClick={() => createTools.mutate()}
            >
              Create {selected.size} tool{selected.size === 1 ? "" : "s"}
            </Button>
          </>
        ) : null}

        {step === "done" ? <Button variant="primary" onClick={close}>Done</Button> : null}
      </ModalFooter>
    </Modal>
  );
}

/* ── Step 1: the document ─────────────────────────────────────────────────── */

function SourceStep({
  mode, setMode, url, setUrl, fileName, onFile, error,
}: {
  mode: "url" | "upload";
  setMode: (m: "url" | "upload") => void;
  url: string;
  setUrl: (v: string) => void;
  fileName: string | null;
  onFile: (name: string, text: string) => void;
  error?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <ModalSection
      title="Where is the document"
      description="OpenAPI 3.0 or 3.1, in JSON or YAML — or a Postman collection, which is converted."
    >
      <div className="flex gap-2">
        <Button
          variant={mode === "url" ? "secondary" : "ghost"}
          size="sm" iconLeft={<Icon icon={CloudArrowDown} size="sm" decorative />}
          onClick={() => setMode("url")}
        >
          From a URL
        </Button>
        <Button
          variant={mode === "upload" ? "secondary" : "ghost"}
          size="sm" iconLeft={<Icon icon={FileArrowUp} size="sm" decorative />}
          onClick={() => setMode("upload")}
        >
          Upload a file
        </Button>
      </div>

      {mode === "url" ? (
        <Field
          label="Document URL"
          description="Fetched by the server, so it needs no CORS and works for any public document. Redirects are followed and re-checked at every hop."
          error={error}
        >
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://petstore3.swagger.io/api/v3/openapi.yaml"
            className="font-code"
          />
        </Field>
      ) : (
        <Field
          label="Document file"
          description="Read in the browser and sent as text. A very large document is better fetched by URL — the server's request limit is smaller than its document limit."
          error={error}
        >
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".json,.yaml,.yml,application/json,text/yaml"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                onFile(file.name, await file.text());
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
              Choose a file
            </Button>
            <Text variant="body-sm" tone={fileName ? "primary" : "muted"} className="font-code">
              {fileName ?? "No file chosen"}
            </Text>
          </div>
        </Field>
      )}

      <ModalNote tone="info" title="Nothing is created by reading a document">
        The operations are listed and you choose which become tools. A document with nine
        hundred operations does not become nine hundred tools.
      </ModalNote>
    </ModalSection>
  );
}

/* ── Step 2: the credential ───────────────────────────────────────────────── */

function AuthStep({
  candidates, notes, connections, connectionId, onConnectionChange,
}: {
  candidates: contracts.SpecAuthCandidate[];
  notes: string[];
  connections: contracts.Connection[];
  connectionId: string | null;
  onConnectionChange: (id: string | null) => void;
}) {
  const primary = candidates[0];

  return (
    <div className="flex flex-col gap-5">
      {notes.length > 0 ? (
        <ModalNote tone="warning" title="What this collection could not tell us">
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </ModalNote>
      ) : null}

      <ModalSection
        title="What this API needs"
        description="Read from the document's own security schemes, including the exact header or parameter name."
      >
        {candidates.map((candidate, index) => (
          <div
            key={candidate.schemeName}
            className={cn(
              "rounded-md border p-3",
              index === 0 ? "border-strong bg-surface-raised" : "border-subtle",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Icon icon={LockKey} size="sm" decorative className="text-fg-muted" />
              <Text variant="body-sm" className="text-fg-primary font-medium">
                {candidate.credentialLabel}
              </Text>
              <span className="border-subtle text-fg-muted font-code rounded-xs border px-1 text-[10px]">
                {candidate.strategy}
              </span>
              <Text variant="caption" tone="muted" className="tabular-nums">
                {candidate.operationCount} operation{candidate.operationCount === 1 ? "" : "s"}
              </Text>
            </div>
            {candidate.needsInput.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {candidate.needsInput.map((line: string) => (
                  <li key={line}>
                    <Text variant="body-sm" tone="secondary">{line}</Text>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </ModalSection>

      <ModalSection
        title="Which connection holds it"
        description="Every tool from this import authenticates through one connection, so the credential is stored once and rotated once."
      >
        <ConnectionPicker
          connections={connections}
          value={connectionId}
          onValueChange={onConnectionChange}
          label="HTTP connection"
          emptyTitle="No HTTP connection yet"
          emptyBody={
            "Create one under Connections first. It holds the credential these tools " +
            "authenticate with, encrypted, so no tool ever stores it."
          }
        />
        {primary ? (
          <ModalNote tone="neutral" title="The credential is never stored on a tool">
            The tool definition names the field it reads —{" "}
            <code className="font-code">
              secret.{primary.requiredSecretFields[0] ?? "value"}
            </code>{" "}
            — and the value stays encrypted on the connection. That is what keeps it out of the
            tool list, the version history and every re-import diff.
          </ModalNote>
        ) : null}
      </ModalSection>
    </div>
  );
}

/* ── Step 3: the operations ───────────────────────────────────────────────── */

function OperationsStep({
  result, visible, tags, tag, setTag, search, setSearch, selected, setSelected, error,
}: {
  result: contracts.SpecImportResult;
  visible: contracts.SpecOperation[];
  tags: string[];
  tag: string | null;
  setTag: (t: string | null) => void;
  search: string;
  setSearch: (s: string) => void;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  error?: string;
}) {
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {result.diff?.hasChanges ? <DiffSummary diff={result.diff} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon icon={MagnifyingGlass} size="sm" decorative className="text-fg-muted pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by path, summary or id"
            aria-label="Filter operations"
            className="pl-8"
          />
        </div>
        {tags.slice(0, 8).map((t) => (
          <Button
            key={t}
            variant={tag === t ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTag(tag === t ? null : t)}
          >
            {t}
          </Button>
        ))}
      </div>

      {error ? <ModalNote tone="danger" title="Could not create the tools">{error}</ModalNote> : null}

      <div className="border-subtle max-h-[46vh] overflow-y-auto rounded-md border">
        {visible.length === 0 ? (
          <div className="p-8 text-center">
            <Text variant="body-sm" tone="secondary">
              No operation matches that filter. Clear it to see all {result.import.operationCount}.
            </Text>
          </div>
        ) : (
          <ul>
            {visible.map((op) => (
              <li key={op.operationKey} className="border-subtle border-b last:border-b-0">
                <label className="hover:bg-surface-raised flex cursor-pointer items-start gap-3 px-3 py-2.5">
                  <Checkbox
                    checked={selected.has(op.operationKey)}
                    onCheckedChange={() => toggle(op.operationKey)}
                    aria-label={`Select ${op.method} ${op.path}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "font-code rounded-xs border px-1 text-[10px] uppercase",
                          op.method === "GET"
                            ? "border-subtle text-fg-secondary"
                            : "border-status-degraded-border text-status-degraded",
                        )}
                      >
                        {op.method}
                      </span>
                      <code className="font-code text-mono-sm text-fg-primary truncate">{op.path}</code>
                      {op.toolId ? (
                        <span className="border-subtle text-fg-muted font-ui rounded-xs border px-1 text-[10px]">
                          already a tool
                        </span>
                      ) : null}
                      {op.deprecated ? (
                        <span className="border-status-degraded-border text-status-degraded font-ui rounded-xs border px-1 text-[10px]">
                          deprecated
                        </span>
                      ) : null}
                    </div>
                    {op.summary ? (
                      <Text variant="body-sm" tone="secondary" className="mt-0.5 block truncate">
                        {op.summary}
                      </Text>
                    ) : null}
                  </div>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ModalNote tone="neutral" title="Re-selecting an existing tool does not overwrite it">
        An operation already backed by a tool produces a change waiting for review instead.
        A tool an agent is granted is never edited by an import.
      </ModalNote>
    </div>
  );
}

function DiffSummary({ diff }: { diff: contracts.SpecDiff }) {
  const granted = diff.affectingGrantedTools.length;
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        granted > 0
          ? "border-status-degraded-border bg-status-degraded-subtle"
          : "border-subtle bg-surface-sunken",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon icon={GitDiff} size="sm" decorative className="text-fg-muted" />
        <Text variant="body-sm" className="text-fg-primary font-medium">
          This document has changed since the last import
        </Text>
      </div>
      <Text variant="body-sm" tone="secondary" className="mt-1 block tabular-nums">
        {diff.added.length} added · {diff.changed.length} changed · {diff.removed.length} removed ·{" "}
        {diff.unchangedCount} unchanged
      </Text>
      {granted > 0 ? (
        <Text variant="body-sm" className="text-status-degraded mt-1.5 block">
          {granted} of the changes touch a tool an agent currently holds. Those wait for review
          in Tool changes — nothing is applied here.
        </Text>
      ) : null}
    </div>
  );
}

/* ── Step 4: what happened ────────────────────────────────────────────────── */

function DoneStep({ created }: { created: contracts.SpecToolsCreated }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Icon icon={CheckCircle} size="md" decorative className="text-status-succeeded mt-0.5" />
        <div>
          <Text variant="body" className="text-fg-max block font-medium">{created.message}</Text>
          <Text variant="body-sm" tone="secondary" className="mt-1 block">
            Each one carries its parameters, body encoding, auth strategy and a starting result
            contract. Trim the contract on any tool whose responses are wide.
          </Text>
        </div>
      </div>

      {created.created.length > 0 ? (
        <ul className="border-subtle rounded-md border">
          {created.created.map((tool) => (
            <li
              key={tool.toolId}
              className="border-subtle flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
            >
              <Text variant="body-sm" className="text-fg-primary truncate">{tool.name}</Text>
              <span className="border-subtle text-fg-muted font-ui shrink-0 rounded-xs border px-1.5 text-[10px] uppercase">
                {tool.riskLevel}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {created.pendingReview.length > 0 ? (
        <ModalNote tone="warning" title={`${created.pendingReview.length} waiting for review`}>
          Those operations already had tools. Their new definitions are proposed rather than
          applied, because an agent may be granted them right now. Review them under Tool changes.
        </ModalNote>
      ) : null}
    </div>
  );
}
