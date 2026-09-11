"use client";

import * as React from "react";
import { HttpSpecEditor } from "./http-spec-editor";
import * as http from "~/lib/tools/http-spec";
import { useQueryClient } from "@tanstack/react-query";
import type { contracts } from "@vectorbea/shared";
import {
  Globe, Database, Code, Cube, Sparkle, PuzzlePiece,
  ShieldCheck, CheckCircle, WarningCircle, ArrowRight, ArrowLeft, Plus,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Checkbox } from "~/components/ui/choice";
import { CodeEditor } from "~/components/ui/code-editor";
import { MonoId } from "~/components/ui/mono-id";
import { OptionCards, Segmented } from "~/components/ui/option-card";
import {
  Modal, ModalBody, ModalDivider, ModalFooter, ModalHeader, ModalLayout,
  ModalNote, ModalRail, ModalSection, ModalStepBar, type ModalStep,
} from "~/components/ui/modal";
import { useApi } from "~/lib/api/api-provider";
import { useApiMutation } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { SummaryList, SummaryRow, ConnectionPicker } from "./create-atoms";
import {
  SqlBuilder, generateSql, EMPTY_BUILDER,
  type SqlBuilderValue,
} from "./sql-builder";
import type { SchemaPreviewResult } from "~/lib/api/client";
import {
  operationsFor, operationById, inputSchemaFor,
  type ProviderOperation, type OperationParam,
} from "~/content/integrations";

/* ══════════════════════════════════════════════════════════════════════════════
   REGISTER A TOOL

   A tool is the only object in this product that can do something irreversible
   to a system that is not ours. Registering one is therefore not a form — it is
   five decisions, and each of them changes what the next one may contain:

     Capability → Connection → Contract → Policy → Review

   THE ORDER IS NOT COSMETIC. The adapter picked in step one decides whether
   step two is mandatory (`toolRequiresConnection` on the API side: http,
   database and llm_generate all 400 without one), which connections are even
   compatible (`compatibleConnectionTypes`), and what step three is asking for —
   a URL and a method, or a SQL template, or an opaque config object.

   VALIDATION IS MIRRORED, NOT DUPLICATED. Everything checked here is checked
   again by `ToolRoutes.create`, and that is the copy that matters. The client
   copy exists because the alternative is spending a round trip to be told the
   URL is missing, and because `validateConfigJsonNotContainsSecrets` rejects a
   whole create over one badly named key — an error far more useful next to the
   field than in a toast.

   THE REVIEW STEP CAN CHECK ITS OWN WORK. `POST /api/tools/test-unsaved`
   validates the exact configuration about to be written, and is side-effect
   free by contract: validating a DELETE endpoint or a database write must never
   execute it. That is the difference between a wizard that feels enterprise and
   one that feels like a guess.
══════════════════════════════════════════════════════════════════════════════ */

type ToolType = "http" | "database" | "code" | "builtin" | "llm_generate" | "custom";
type RiskLevel = "low" | "medium" | "high" | "critical";
type Lifecycle = "active" | "paused" | "draft";

const TOOL_TYPES: {
  value: ToolType;
  label: string;
  description: string;
  icon: typeof Globe;
  /** Connection types this adapter accepts, mirroring `compatibleConnectionTypes`. */
  connectionTypes: string[] | "any" | "none";
}[] = [
  { value: "http", label: "HTTP API", description: "Call a REST or JSON endpoint. A connection is optional — attach one for a credential or a private host.", icon: Globe, connectionTypes: ["http"] },
  { value: "database", label: "Database", description: "Run a parameterised SQL template against a database connection.", icon: Database, connectionTypes: ["database"] },
  { value: "llm_generate", label: "LLM generation", description: "Generate text with a model, billed to an LLM connection.", icon: Sparkle, connectionTypes: ["llm"] },
  { value: "code", label: "Code", description: "Run sandboxed code in the worker. No external credentials.", icon: Code, connectionTypes: "none" },
  { value: "builtin", label: "Built-in", description: "A capability the platform ships with — hashing, formatting, maths.", icon: Cube, connectionTypes: "none" },
  { value: "custom", label: "Custom / MCP", description: "An MCP server or a bespoke adapter. Any connection type, or none.", icon: PuzzlePiece, connectionTypes: "any" },
];

const RISK_TIERS: { value: RiskLevel; label: string; markerClassName: string; blurb: string }[] = [
  { value: "low", label: "Low", markerClassName: "bg-risk-low", blurb: "Reads public or non-sensitive data. Safe to call unattended." },
  { value: "medium", label: "Medium", markerClassName: "bg-risk-medium", blurb: "Reads customer data, or writes somewhere reversible." },
  { value: "high", label: "High", markerClassName: "bg-risk-high", blurb: "Writes to a system of record, or spends money. Approval on by default." },
  { value: "critical", label: "Critical", markerClassName: "bg-risk-critical", blurb: "Irreversible, or externally visible. Always gated, always audited." },
];

/** So a catalogue default can raise the risk tier without ever lowering one. */
const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * Mirrors `Validation.FORBIDDEN_CONFIG_KEYS`.
 *
 * The API normalises by lowercasing and stripping separators before testing for
 * containment, so the same normalisation happens here — otherwise `API-Key`
 * passes the client check and fails the server one, which is the worst of both.
 */
const FORBIDDEN_CONFIG_FRAGMENTS = [
  "password", "secret", "apikey", "token", "bearer", "credential",
  "privatekey", "accesskey", "secretkey", "clientsecret", "authtoken",
  "connectionstring",
];

function forbiddenConfigKey(config: Record<string, unknown>): string | null {
  for (const key of Object.keys(config)) {
    const normalised = key.toLowerCase().replace(/[_-]/g, "");
    if (FORBIDDEN_CONFIG_FRAGMENTS.some((fragment) => normalised.includes(fragment))) return key;
  }
  return null;
}

function parseObject(source: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE PARAMETERS OF ONE OPERATION — and where each of them is decided.

   This is the screen the request in the brief is about: connect Gmail, and the
   tool asks for a FROM and a TO rather than for a URL.

   The binding toggle is not a convenience. `config` bakes the value into the
   registered tool; `input` puts it in the schema and hands the choice to the
   agent at call time. For `to` on an email tool those are two completely
   different tools — one can mail your ops alias and nothing else, the other can
   mail whoever appears in the model's context. The product has a word for that
   already, so it is said in that word: blast radius.
══════════════════════════════════════════════════════════════════════════════ */
function OperationParams({
  operation, values, onValue, bindings, onBinding,
}: {
  operation: ProviderOperation;
  values: Record<string, string>;
  onValue: (name: string, value: string) => void;
  bindings: Record<string, "config" | "input">;
  onBinding: (name: string, binding: "config" | "input") => void;
}) {
  const bindingOf = (param: OperationParam) => bindings[param.name] ?? param.binding;
  const fixed = operation.params.filter((param) => bindingOf(param) === "config");
  const perCall = operation.params.filter((param) => bindingOf(param) === "input");

  return (
    <div className="grid gap-4">
      <ModalSection
        title="Fixed when the tool is registered"
        description="The agent cannot change these. Anything here is a bound the engine enforces on every call."
      >
        {fixed.length === 0 ? (
          <ModalNote tone="warning" title="Nothing is fixed">
            Every parameter is chosen by the agent at call time. That is legitimate for a read, and
            worth a second look for anything that writes.
          </ModalNote>
        ) : (
          <div className="grid gap-3">
            {fixed.map((param) => (
              <div key={param.name} className="grid gap-1.5">
                <Field label={param.label} required={param.required} description={param.help}>
                  {param.type === "text" || param.type === "json" ? (
                    <Textarea
                      mono={param.type === "json"}
                      minRows={2}
                      maxRows={5}
                      value={values[param.name] ?? ""}
                      onChange={(event) => onValue(param.name, event.target.value)}
                      placeholder={param.placeholder}
                    />
                  ) : (
                    <Input
                      type={param.type === "number" ? "number" : "text"}
                      value={values[param.name] ?? ""}
                      onChange={(event) => onValue(param.name, event.target.value)}
                      placeholder={param.placeholder}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  )}
                </Field>
                {param.bindable ? (
                  <div className="flex justify-end">
                    <Button size="xs" variant="ghost" onClick={() => onBinding(param.name, "input")}>
                      Let the agent choose
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </ModalSection>

      <ModalDivider />

      <ModalSection
        title="Supplied on every call"
        description="These become the tool's input schema. The agent, or an earlier node, provides them."
      >
        {perCall.length === 0 ? (
          <ModalNote title="Nothing is left to the caller">
            Every value is fixed, so this tool does exactly one thing with exactly one set of
            arguments. That is often the safest tool there is.
          </ModalNote>
        ) : (
          <ul className="grid gap-1.5">
            {perCall.map((param) => (
              <li key={param.name} className="grid gap-0.5">
                <div className="flex min-h-6 items-center justify-between gap-3">
                  <Text variant="body-sm" tone="primary" className="min-w-0 truncate font-medium">
                    {param.label}
                    {param.required ? null : (
                      <Text variant="caption" tone="disabled" className="ml-1.5">optional</Text>
                    )}
                  </Text>
                  {param.bindable ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => onBinding(param.name, "config")}
                    >
                      Fix this value
                    </Button>
                  ) : null}
                </div>
                {param.help ? (
                  <Text variant="caption" tone="muted" className="block leading-snug">{param.help}</Text>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </ModalSection>
    </div>
  );
}

/** Sentinel for "I want the raw request form" on a provider that has a catalogue. */
const CUSTOM_REQUEST = "__custom__";

/**
 * The first registration-bound parameter left empty, said in the field's words.
 *
 * These are required because the request cannot be formed without them — a
 * GitHub issue needs an owner and a repo before there is a URL to POST to — and
 * because they are the ones the agent will NOT be able to supply later.
 */
function missingBoundParam(
  operation: ProviderOperation,
  values: Record<string, string>,
  bindingOf: (param: OperationParam) => "config" | "input",
): string | null {
  for (const param of operation.params) {
    if (!param.required || bindingOf(param) !== "config") continue;
    if (!values[param.name]?.trim()) {
      return `${operation.label} needs ${param.label.toLowerCase()} — it is fixed when the tool is registered, not chosen per call.`;
    }
  }
  return null;
}

const EMPTY_SCHEMA = '{\n  "type": "object",\n  "properties": {}\n}';

const STEPS: ModalStep[] = [
  { id: "capability", label: "Capability", summary: "What it is and what it talks to" },
  { id: "connection", label: "Connection", summary: "Which credential it runs as" },
  { id: "contract", label: "Contract", summary: "Config and input/output schema" },
  { id: "policy", label: "Policy", summary: "Risk, approval, timeout" },
  { id: "review", label: "Review", summary: "Validate, then register" },
];

export interface CreateToolDialogProps {
  open: boolean;
  presetConnectionId?: string | null;
  presetHttpSpec?: http.SpecDocument;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful create, with the persisted tool. */
  onCreated?: (tool: contracts.Tool) => void;
}

export function CreateToolDialog({ open, onOpenChange, onCreated, presetConnectionId, presetHttpSpec }: CreateToolDialogProps) {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const [step, setStep] = React.useState(0);
  const [connections, setConnections] = React.useState<contracts.Connection[]>([]);

  /* ── Form state ─────────────────────────────────────────────────────────── */
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<ToolType>("http");
  const [httpSpec, setHttpSpec] = React.useState<http.SpecDocument>(presetHttpSpec ?? http.emptySpec);
  const [connectionId, setConnectionId] = React.useState<string | null>(presetConnectionId ?? null);

  const [method, setMethod] = React.useState<string>("GET");
  const [url, setUrl] = React.useState("");

  /* WHAT THIS TOOL ACTUALLY DOES, in the provider's own vocabulary.
     `operationId` null with a provider that HAS operations means "custom
     request" — the escape hatch back to the raw method/URL form. A catalogue
     nobody can step outside of is a ceiling, not a help. */
  const [operationId, setOperationId] = React.useState<string | null>(null);
  const [operationValues, setOperationValues] = React.useState<Record<string, string>>({});
  /* Per-parameter overrides of the catalogue's default binding. This is the
     blast-radius decision: a Gmail tool whose `to` is bound here can email one
     address forever, and the same tool with `to` on input can email anyone the
     model can be talked into naming. */
  const [bindings, setBindings] = React.useState<Record<string, "config" | "input">>({});
  const [sqlTemplate, setSqlTemplate] = React.useState("");
  const [writes, setWrites] = React.useState(false);

  /* The guided builder owns the statement for database tools. `handWritten`
     is the escape hatch: generated SQL covers the shapes people actually
     register, not every statement anybody could ever want, and a builder with
     no way out is a worse tool than a textarea. */
  const [handWritten, setHandWritten] = React.useState(false);
  const [builder, setBuilder] = React.useState<SqlBuilderValue>(EMPTY_BUILDER);
  const [schema, setSchema] = React.useState<SchemaPreviewResult | null>(null);
  const [schemaLoading, setSchemaLoading] = React.useState(false);
  const [schemaError, setSchemaError] = React.useState<string | null>(null);
  const [schemaNonce, setSchemaNonce] = React.useState(0);
  const [extraConfig, setExtraConfig] = React.useState("{}");
  const [inputSchema, setInputSchema] = React.useState(EMPTY_SCHEMA);
  const [outputSchema, setOutputSchema] = React.useState(EMPTY_SCHEMA);

  const [risk, setRisk] = React.useState<RiskLevel>("low");
  const [requiresApproval, setRequiresApproval] = React.useState(false);
  const [approvalTouched, setApprovalTouched] = React.useState(false);
  const [timeoutMs, setTimeoutMs] = React.useState("10000");
  const [idempotency, setIdempotency] = React.useState("input_hash");
  const [lifecycle, setLifecycle] = React.useState<Lifecycle>("active");

  const [validation, setValidation] = React.useState<{ valid: boolean; message: string } | null>(null);
  const [validating, setValidating] = React.useState(false);

  /* ── Load connections once the dialog is actually open ──────────────────── */
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    void api.connections
      .list({ workspaceId: scope.workspaceId, environmentId: null, page: 1, pageSize: 100 })
      .then((page) => { if (alive) setConnections(page.items); })
      .catch(() => { if (alive) setConnections([]); });
    return () => { alive = false; };
  }, [api, open, scope.workspaceId]);

  /**
   * Read the chosen database's structure.
   *
   * Keyed on the connection so switching connections re-reads rather than
   * offering the previous database's tables, which would generate a statement
   * against tables the new connection has never heard of.
   */
  React.useEffect(() => {
    if (!open || type !== "database" || !connectionId) {
      setSchema(null);
      setSchemaError(null);
      return;
    }
    let alive = true;
    setSchemaLoading(true);
    setSchemaError(null);
    void api.connections
      .schemaPreview(connectionId, { workspaceId: scope.workspaceId, environmentId: null })
      .then((result) => { if (alive) { setSchema(result); setSchemaLoading(false); } })
      .catch((cause: unknown) => {
        if (!alive) return;
        setSchema(null);
        setSchemaLoading(false);
        setSchemaError(
          cause instanceof Error
            ? cause.message
            : "The database did not answer. Test the connection, then try again.",
        );
      });
    return () => { alive = false; };
  }, [api, open, type, connectionId, scope.workspaceId, schemaNonce]);

  /* Switching to another table's shape invalidates a selection made against the
     old one. Resetting here rather than in the panel keeps the builder value the
     single source of truth. */
  React.useEffect(() => { setBuilder(EMPTY_BUILDER); }, [connectionId]);

  React.useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [step]);

  /**
   * The risk tier moves the approval default, and stops doing so the moment the
   * operator touches the checkbox.
   *
   * `ToolRoutes.create` applies the same default server-side when the field is
   * absent (`type == "database" || riskLevel in {high, critical}`). Showing it
   * here rather than letting the server apply it silently is the difference
   * between a policy the operator chose and one they discover later.
   */
  React.useEffect(() => {
    if (approvalTouched) return;
    setRequiresApproval(risk === "high" || risk === "critical" || type === "database");
  }, [risk, type, approvalTouched]);

  /* ── Derived ────────────────────────────────────────────────────────────── */
  const spec = TOOL_TYPES.find((candidate) => candidate.value === type)!;
  /*
   * Mirrors `toolRequiresConnection` on the API side, and `http` is
   * deliberately not in it.
   *
   * A connection gives an HTTP tool a base URL and a credential. The spec
   * carries its own absolute URL, so a public endpoint needs neither — and
   * `HttpToolResolver` has always run a connection-less tool as PUBLIC egress
   * with no secret, which is strictly less reach, not more. Asking for one
   * anyway made "register a tool for this public API" a dead end whose only
   * exit was inventing an empty connection.
   */
  const requiresConnection = type === "database" || type === "llm_generate";

  const compatible = React.useMemo(() => {
    if (spec.connectionTypes === "none") return [];
    if (spec.connectionTypes === "any") return connections;
    return connections.filter((connection) => (spec.connectionTypes as string[]).includes(connection.type));
  }, [connections, spec.connectionTypes]);

  /** The connection the tool will run as, resolved from the picker. */
  const selectedConnection = React.useMemo(
    () => connections.find((connection) => connection.id === connectionId) ?? null,
    [connections, connectionId],
  );

  /**
   * What this connection can be asked to do.
   *
   * Empty for a generic HTTP or webhook connection, which is the honest answer:
   * Vectorbea has no idea what lives behind an arbitrary base URL, so the raw
   * method/URL form is the right thing to show. It is NOT empty for Gmail,
   * Slack, GitHub, Notion, Airtable, HubSpot, Sheets or Jira, and showing those
   * users a blank URL field was asking them to know that Gmail's send endpoint
   * is `POST /gmail/v1/users/me/messages/send` with a base64url RFC 2822 body.
   */
  const operations = React.useMemo(
    () => (type === "http" ? operationsFor(selectedConnection?.provider) : []),
    [type, selectedConnection?.provider],
  );
  const operation = React.useMemo(() => operationById(operationId) ?? null, [operationId]);
  const usesCatalogue = operations.length > 0;

  /** The binding in force for a parameter: the operator's choice, else the catalogue's. */
  const bindingOf = React.useCallback(
    (param: OperationParam) => bindings[param.name] ?? param.binding,
    [bindings],
  );

  /* Switching connection invalidates an operation belonging to the previous
     provider — a Slack operation on a Gmail connection would post a request
     Gmail has never heard of. */
  React.useEffect(() => {
    setOperationId(presetHttpSpec ? CUSTOM_REQUEST : null);
    setOperationValues({});
    setBindings({});
  }, [connectionId, presetHttpSpec]);

  /* Choosing an operation seeds the request it issues. The method and path are
     the vendor's, not the operator's, so they are set rather than asked for. */
  React.useEffect(() => {
    if (!operation) return;
    setMethod(operation.method);
    setUrl(operation.path);
    setWrites(operation.writes);
    setOperationValues({});
    setBindings({});
  }, [operation]);

  const selectedTable = React.useMemo(
    () => (schema?.tables ?? []).find((t) => `${t.schema}.${t.table}` === builder.table) ?? null,
    [schema, builder.table],
  );

  /** What the builder would register. Recomputed from the choices, never stored. */
  const generated = React.useMemo(() => generateSql(builder, selectedTable), [builder, selectedTable]);

  /* The builder drives the statement, the write flag and both schemas. Mirroring
     them into the same state the hand-written path uses means the review step,
     the payload and the validation call all stay in one shape. */
  React.useEffect(() => {
    if (type !== "database" || handWritten) return;
    setSqlTemplate(generated.sql);
    setWrites(generated.writes);
    setInputSchema(JSON.stringify(generated.inputSchema, null, 2));
    setOutputSchema(JSON.stringify(generated.outputSchema, null, 2));
  }, [type, handWritten, generated]);

  /* The operation owns the input schema for exactly the same reason the SQL
     builder owns it for database tools: the parameters ARE the contract, and a
     hand-written schema that disagrees with them is a runtime failure dressed
     as a config file. */
  React.useEffect(() => {
    if (!operation) return;
    setInputSchema(JSON.stringify(inputSchemaFor(operation, bindings), null, 2));
  }, [operation, bindings]);

  /* The vendor decides how dangerous the call is, so the tier starts there.
     The operator may raise it; nothing here lowers a tier they chose. */
  React.useEffect(() => {
    if (!operation) return;
    setRisk((current) => (RISK_ORDER[operation.risk] > RISK_ORDER[current] ? operation.risk : current));
  }, [operation]);

  /** True while the builder owns the two schema documents. */
  const schemasAreGenerated = type === "database" && !handWritten;

  const trimmedName = name.trim();
  const parsedExtra = parseObject(extraConfig);
  const customHttp = type === "http" && !operation;
  const parsedInput = customHttp ? http.inputSchema(httpSpec) : parseObject(inputSchema);
  const parsedOutput = parseObject(outputSchema);

  /**
   * The path with config-bound parameters already substituted.
   *
   * Input-bound ones stay as `{name}` placeholders and are filled at run time by
   * `HttpNodeExecutor.substitutePathParams`, which URL-encodes them. Substituting
   * a config value here rather than at run time is what makes the binding real:
   * a value baked into the stored URL is one the agent has no way to move.
   */
  const operationUrl = React.useMemo(() => {
    if (!operation) return url.trim();
    let path = operation.path;
    for (const param of operation.params) {
      if (bindingOf(param) !== "config") continue;
      const value = operationValues[param.name]?.trim();
      if (!value) continue;
      path = path.split(`{${param.name}}`).join(encodeURIComponent(value));
    }
    return path;
  }, [operation, operationValues, bindingOf, url]);

  const config = React.useMemo<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = { ...(parsedExtra ?? {}) };
    if (type === "http" && operation) {
      base.method = method;
      base.url = operation ? operationUrl : url.trim();
      if (operation) {
        /* Recorded so the tool detail page, and anybody reading the row in two
           months, can say WHICH operation this is rather than reverse-engineering
           it from a URL. */
        base.operationId = operation.id;
        /* Parameters bound at registration. Not secrets — those are refused by
           `validateConfigJsonNotContainsSecrets` and live on the connection. */
        const bound: Record<string, string> = {};
        for (const param of operation.params) {
          if (bindingOf(param) !== "config") continue;
          const value = operationValues[param.name]?.trim();
          if (value) bound[param.name] = value;
        }
        if (Object.keys(bound).length > 0) base.boundParameters = bound;
      }
    }
    if (type === "database") {
      base.sqlTemplate = sqlTemplate.trim();
      base.write = writes;
      base.readOnly = !writes;
      /* THE ORDER OF THESE KEYS IS THE ORDER OF `$1..$n`.
         `ToolNodeExecutor` builds its positional bind list by walking
         `config.parameters` in key order, so this object is not a set of
         defaults — it is the parameter vector. It is written from the generated
         list rather than from the input schema for exactly that reason: a JSON
         Schema `properties` object carries no ordering guarantee anyone should
         rely on, and getting it wrong binds the right values to the wrong
         placeholders. */
      if (!handWritten && generated.parameters.length > 0) {
        base.parameters = Object.fromEntries(generated.parameters.map((key) => [key, null]));
      }
    }
    return base;
  }, [
    parsedExtra, type, method, url, sqlTemplate, writes, handWritten, generated.parameters,
    operation, operationUrl, operationValues, bindingOf,
  ]);

  const forbiddenKey = forbiddenConfigKey(config);
  const timeoutValue = Number(timeoutMs);
  const timeoutValid = Number.isInteger(timeoutValue) && timeoutValue > 0;

  const stepErrors: (string | null)[] = [
    !trimmedName ? "Give the tool a name — it is what an agent grant refers to." : null,
    requiresConnection && !connectionId
      ? `A ${spec.label.toLowerCase()} tool runs as a connection. Pick one, or the API will refuse the create.`
      : null,
    type === "http" && usesCatalogue && !operation && operationId !== CUSTOM_REQUEST
      ? "Pick what this tool does. Every option is one call to the connected account."
      : type === "http" && operation
        ? missingBoundParam(operation, operationValues, bindingOf)
        : type === "http" && http.specProblems(httpSpec).length > 0
          ? http.specProblems(httpSpec)[0]!
      : type === "database" && !handWritten && generated.problem
        ? generated.problem
        : type === "database" && !sqlTemplate.trim()
          ? handWritten
            ? "Enter the SQL statement this tool runs."
            : "Finish the statement above before continuing."
        : parsedExtra === null
          ? "Extra configuration must be a JSON object."
          : forbiddenKey
            ? `config.${forbiddenKey} looks like a secret. Credentials belong on the connection, never in tool config.`
            : parsedInput === null
              ? "The input schema must be a JSON object."
              : parsedOutput === null
                ? "The output schema must be a JSON object."
                : null,
    !timeoutValid ? "Timeout must be a whole number of milliseconds above zero." : null,
    null,
  ];

  /**
   * The furthest step the operator may jump to: the first one carrying an error,
   * or the last step when every one before it is clean.
   *
   * Deliberately NOT "the highest step visited". A wizard that lets you skip
   * back, break step two and then jump forward to Review is a wizard that
   * submits a body the API rejects.
   */
  const firstBroken = stepErrors.findIndex((entry) => entry !== null);
  const reachableIndex = firstBroken === -1 ? STEPS.length - 1 : firstBroken;

  const complete = reachableIndex === STEPS.length - 1;
  const validationKey = JSON.stringify({ type, connectionId, config, httpSpec, inputSchema, outputSchema });
  React.useEffect(() => { setValidation(null); }, [validationKey]);

  /* ── Validate against the API, without writing ──────────────────────────── */
  async function validate() {
    setValidating(true);
    setValidation(null);
    try {
      const result = await api.tools.testDraft(
        { type, connectionId, config, ...(type === "http" && !operation ? { httpSpec } : {}), inputSchema: parsedInput ?? {}, outputSchema: parsedOutput ?? {} },
        { workspaceId: scope.workspaceId, environmentId: null },
      );
      setValidation({ valid: result.valid, message: result.message });
    } catch (error) {
      setValidation({
        valid: false,
        message: error instanceof Error ? error.message : "The configuration could not be validated.",
      });
    } finally {
      setValidating(false);
    }
  }

  /* ── Create ─────────────────────────────────────────────────────────────── */
  const create = useApiMutation<contracts.Tool, void>({
    mutationFn: async () => {
      return api.tools.create(
        {
          name: trimmedName,
          description: description.trim() || null,
          type,
          connectionId,
          config,
          ...(type === "http" && !operation ? { httpSpec } : {}),
          inputSchema: parsedInput ?? {},
          outputSchema: parsedOutput ?? {},
          riskLevel: risk,
          requiresApproval,
          timeoutMs: timeoutValue,
          idempotencyStrategy: idempotency,
          retryPolicy: {},
          status: lifecycle,
        },
        { workspaceId: scope.workspaceId, environmentId: null },
      );
    },
    onSuccess: (tool) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tools.all({ workspaceId: scope.workspaceId, environmentId: null }),
      });
      onCreated?.(tool);
      onOpenChange(false);
    },
  });

  /* ── Reset on close, not on open ────────────────────────────────────────── */
  React.useEffect(() => {
    if (open) return;
    // Deferred so the exit animation does not play against a blanked form.
    const timer = window.setTimeout(() => {
      setStep(0);
      setName(""); setDescription(""); setType("http"); setConnectionId(null); setHttpSpec(http.emptySpec());
      setMethod("GET"); setUrl(""); setSqlTemplate(""); setWrites(false);
      setExtraConfig("{}"); setInputSchema(EMPTY_SCHEMA); setOutputSchema(EMPTY_SCHEMA);
      setBuilder(EMPTY_BUILDER); setHandWritten(false);
      setSchema(null); setSchemaError(null);
      setRisk("low"); setRequiresApproval(false); setApprovalTouched(false);
      setTimeoutMs("10000"); setIdempotency("input_hash"); setLifecycle("active");
      setValidation(null);
      create.reset();
    }, 200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Changing the adapter invalidates a connection chosen for the old one. */
  function chooseType(next: ToolType) {
    setType(next);
    setConnectionId(null);
    setValidation(null);
  }

  const railSteps: ModalStep[] = STEPS.map((entry, index) => ({
    ...entry,
    value:
      index === 0 ? (trimmedName || undefined)
        : index === 1 ? (connectionId ? connections.find((c) => c.id === connectionId)?.name : requiresConnection ? undefined : "None needed")
          : index === 2
        ? (operation ? operation.label
          : type === "http" ? `${http.method(httpSpec)} endpoint`
            : type === "database" ? "SQL template" : undefined)
            : index === 3 ? `${RISK_TIERS.find((tier) => tier.value === risk)?.label} risk${requiresApproval ? " · gated" : ""}`
              : undefined,
  }));

  const error = stepErrors[step];
  const busy = create.isPending;

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="xl" dismissible={!busy}>
      <ModalHeader
        eyebrow="Build · Tools"
        title="Register a tool"
        description="A tool is a capability an agent may be granted. What you set here is enforced by the engine, not by this screen."
        closeDisabled={busy}
      />

      <ModalStepBar steps={railSteps} activeIndex={step} reachableIndex={reachableIndex} onSelect={setStep} />

      <ModalLayout
        rail={
          <ModalRail
            eyebrow="Registration"
            steps={railSteps}
            activeIndex={step}
            reachableIndex={reachableIndex}
            onSelect={setStep}
            footnote="Nothing is called until an agent is granted this tool and a run reaches it."
          />
        }
      >
        <ModalBody ref={bodyRef}>
          {step === 0 ? (
            <div className="grid gap-4">
              <ModalSection
                title="Identity"
                description="The name is what appears in an agent's grant list and in every audit line."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Keeps the header the same shape as Lifecycle beside it,
                      so the two controls land on one line. */}
                  <Field
                    label="Name"
                    required
                    description="Renaming later is safe — agents bind by id."
                    characterCount={{ value: name.length, max: 255 }}
                  >
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Look up customer"
                      maxLength={255}
                      autoComplete="off"
                      autoFocus
                    />
                  </Field>
                  <Field label="Lifecycle" description="Draft tools cannot be called by a run.">
                    <Select
                      value={lifecycle}
                      onValueChange={(value) => setLifecycle(value as Lifecycle)}
                      options={[
                        { value: "active", label: "Active", description: "Callable now" },
                        { value: "paused", label: "Paused", description: "Registered, refuses calls" },
                        { value: "draft", label: "Draft", description: "Not yet in service" },
                      ]}
                    />
                  </Field>
                </div>
                <Field label="Description" description="One line. What it does, and to which system.">
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Fetches a customer record by id from the billing API."
                    minRows={2}
                    maxRows={5}
                  />
                </Field>
              </ModalSection>

              <ModalDivider />

              <ModalSection
                title="Adapter"
                description="How the engine executes it. This cannot be changed after registration."
              >
                <OptionCards
                  label="Adapter type"
                  columns={3}
                  value={type}
                  onValueChange={(value) => chooseType(value as ToolType)}
                  options={TOOL_TYPES.map((entry) => ({
                    value: entry.value,
                    label: entry.label,
                    description: entry.description,
                    icon: entry.icon,
                    badge:
                      entry.connectionTypes !== "none" && entry.connectionTypes !== "any" ? (
                        <Text variant="caption" tone="muted">
                          needs {entry.connectionTypes[0]}
                        </Text>
                      ) : null,
                  }))}
                />
              </ModalSection>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4">
              <ModalSection
                title="Connection"
                description={
                  requiresConnection
                    ? `A ${spec.label.toLowerCase()} tool executes as a stored credential. Only ${
                        spec.connectionTypes === "any" ? "workspace" : (spec.connectionTypes as string[])[0]
                      } connections are compatible.`
                    : type === "http"
                      ? "Optional. Pick one to inherit its base URL, its credential and its allowed hosts — or leave it as None for a public endpoint the tool calls on its own."
                      : "This adapter runs inside the worker and needs no external credential."
                }
              >
                {requiresConnection || spec.connectionTypes === "any" ? (
                  <ConnectionPicker
                    label="Connection"
                    connections={compatible}
                    value={connectionId}
                    onValueChange={setConnectionId}
                    /* Says what each connection will let you BUILD, which is the
                       only thing that distinguishes them at this moment: for an
                       HTTP tool every SaaS connection is type `http`, so the
                       picker used to be a list of names with no consequence
                       attached to picking one over another. */
                    badgeFor={(connection) => {
                      if (type !== "http") return null;
                      const count = operationsFor(connection.provider).length;
                      return count > 0 ? (
                        <Text variant="caption" tone="muted">
                          {count} {count === 1 ? "operation" : "operations"}
                        </Text>
                      ) : (
                        <Text variant="caption" tone="disabled">custom request</Text>
                      );
                    }}
                    allowNone={!requiresConnection}
                    noneDescription={
                      type === "http"
                        ? "Call a public endpoint. No credential, no private egress, no host widening."
                        : "Run without credentials."
                    }
                    emptyTitle={`No compatible ${spec.label.toLowerCase()} connection`}
                    emptyBody={
                      <>
                        The registry has no connection this adapter can use. Create one first — the
                        credential lives on the connection, never on the tool.
                      </>
                    }
                  />
                ) : (
                  <ModalNote title="No connection required">
                    {spec.label} tools execute in the worker sandbox. Anything they need is passed as
                    input at call time.
                  </ModalNote>
                )}
              </ModalSection>

              {requiresConnection ? (
                <ModalNote tone="info" title="Why the credential is not here">
                  Secrets live on the connection and are referenced by id. A tool config containing a
                  key is rejected by the API, so rotating a credential never means editing a tool.
                </ModalNote>
              ) : type === "http" && !connectionId ? (
                <ModalNote title="Without a connection this tool is public-only">
                  It reaches exactly what anyone on the internet can reach: no credential is sent,
                  private and link-local addresses are refused, and it cannot be widened to an
                  internal host. Attach a connection later if any of that changes.
                </ModalNote>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4">
              {type === "http" && usesCatalogue ? (
                <ModalSection
                  title="What this tool does"
                  description={`One call to the connected ${selectedConnection?.provider ?? "account"}. Everything below is the request Vectorbea will issue — you are choosing the capability, not writing the endpoint.`}
                >
                  <OptionCards
                    label="Operation"
                    columns={1}
                    density="compact"
                    value={operationId}
                    onValueChange={setOperationId}
                    options={[
                      ...operations.map((entry) => ({
                        value: entry.id,
                        label: entry.label,
                        description: (
                          <span className="grid gap-0.5">
                            <span>{entry.description}</span>
                            <Text variant="caption" tone="disabled" className="block leading-snug">
                              {entry.useCase}
                            </Text>
                          </span>
                        ),
                        badge: entry.writes ? (
                          <Text variant="caption" tone="muted">writes</Text>
                        ) : (
                          <Text variant="caption" tone="disabled">reads</Text>
                        ),
                      })),
                      {
                        value: CUSTOM_REQUEST,
                        label: "Custom request",
                        description:
                          "Write the method and URL by hand. The catalogue covers the common calls, not every call the API has.",
                      },
                    ]}
                  />
                </ModalSection>
              ) : null}

              {type === "http" && operation ? (
                <>
                  <ModalDivider />
                  <OperationParams
                    operation={operation}
                    values={operationValues}
                    onValue={(name, value) =>
                      setOperationValues((current) => ({ ...current, [name]: value }))
                    }
                    bindings={bindings}
                    onBinding={(name, binding) =>
                      setBindings((current) => ({ ...current, [name]: binding }))
                    }
                  />
                  <ModalNote title="The request this becomes">
                    <span className="font-code text-mono-sm break-all">
                      {method} {operationUrl}
                    </span>
                  </ModalNote>
                </>
              ) : null}

              {type === "http" && (!usesCatalogue || operationId === CUSTOM_REQUEST) ? (
                <HttpSpecEditor
                  value={httpSpec}
                  onChange={setHttpSpec}
                  connectionBaseUrl={String(selectedConnection?.config?.baseUrl ?? selectedConnection?.config?.url ?? "")}
                />
              ) : null}

              {type === "database" ? (
                <>
                  {handWritten ? (
                    <ModalSection
                      title="Statement"
                      description="Bind values with $1, $2 … and list them in order under Additional configuration as `parameters`."
                    >
                      <Field label="SQL statement" required>
                        <Textarea
                          mono
                          autoGrow={false}
                          minRows={5}
                          value={sqlTemplate}
                          onChange={(event) => setSqlTemplate(event.target.value)}
                          placeholder="SELECT id, email, tier FROM customers WHERE id = $1"
                          spellCheck={false}
                        />
                      </Field>
                      <Checkbox
                        checked={writes}
                        onCheckedChange={(value) => setWrites(value === true)}
                        description="Registers the tool as a write. Database writes are approval-gated by default."
                      >
                        This statement modifies data
                      </Checkbox>
                    </ModalSection>
                  ) : (
                    <SqlBuilder
                      value={builder}
                      onChange={setBuilder}
                      schema={schema}
                      loading={schemaLoading}
                      error={schemaError}
                      onRetry={() => setSchemaNonce((n) => n + 1)}
                      hasConnection={Boolean(connectionId)}
                      generated={generated}
                    />
                  )}

                  <div className="flex justify-end">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        // Leaving the builder keeps whatever it generated, so
                        // the textarea opens on the statement just built rather
                        // than on an empty box.
                        setHandWritten((previous) => !previous);
                      }}
                    >
                      {handWritten ? "Back to the guided builder" : "Write the SQL myself"}
                    </Button>
                  </div>
                </>
              ) : null}

              <ModalSection
                title={type === "http" || type === "database" ? "Additional configuration" : "Configuration"}
                description="Merged into the stored config. Credentials are rejected — they belong on the connection."
              >
                <CodeEditor
                  value={extraConfig}
                  onValueChange={setExtraConfig}
                  minRows={5}
                  aria-label="Additional configuration"
                />
                {forbiddenKey ? (
                  <ModalNote tone="danger" title={`config.${forbiddenKey} looks like a secret`}>
                    The API refuses a config carrying credential-shaped keys. Move it to the connection
                    and reference it by id.
                  </ModalNote>
                ) : null}
              </ModalSection>

              <ModalDivider />

              <ModalSection
                title="Schemas"
                description={
                  schemasAreGenerated
                    ? "Derived from the fields and filters you chose. Switch to writing the SQL yourself to edit them directly."
                    : "What an agent must pass, and what it can rely on getting back. Both are JSON Schema objects."
                }
              >
                <div className="grid gap-3 lg:grid-cols-2">
                  <Field label="Input schema" description={customHttp ? "Generated from the HTTP inputs above. Bound values are excluded." : undefined}>
                    <CodeEditor
                      value={customHttp ? JSON.stringify(parsedInput, null, 2) : inputSchema}
                      onValueChange={setInputSchema}
                      minRows={8}
                      aria-label="Input schema"
                      disabled={schemasAreGenerated || customHttp}
                    />
                  </Field>
                  <Field label="Output schema">
                    <CodeEditor
                      value={outputSchema}
                      onValueChange={setOutputSchema}
                      minRows={8}
                      aria-label="Output schema"
                      disabled={schemasAreGenerated}
                    />
                  </Field>
                </div>
              </ModalSection>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4">
              <ModalSection
                title="Risk tier"
                description="Drives the default approval gate, the audit level, and how the tool is ranked in the registry."
              >
                <Segmented
                  label="Risk tier"
                  value={risk}
                  onValueChange={(value) => setRisk(value as RiskLevel)}
                  options={RISK_TIERS.map(({ value, label, markerClassName }) => ({ value, label, markerClassName }))}
                />
                <Text variant="caption" tone="muted" className="block leading-snug">
                  {RISK_TIERS.find((tier) => tier.value === risk)?.blurb}
                </Text>
              </ModalSection>

              <ModalSection title="Controls" description="Persisted with the tool and enforced by the engine, independently of this UI.">
                <Checkbox
                  checked={requiresApproval}
                  onCheckedChange={(value) => { setApprovalTouched(true); setRequiresApproval(value === true); }}
                  description="A run reaching this tool pauses until a person approves it."
                >
                  Require human approval
                </Checkbox>
                {!requiresApproval && (risk === "high" || risk === "critical") ? (
                  <ModalNote tone="warning" title="Gate turned off on a high-risk tool">
                    Any agent granted this tool will be able to call it unattended. That is a choice
                    worth making deliberately.
                  </ModalNote>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Timeout"
                    description="Milliseconds. The engine abandons the call after this."
                    error={!timeoutValid ? "Must be a whole number above zero." : undefined}
                  >
                    <Input
                      mono
                      type="number"
                      min={1}
                      step={100}
                      value={timeoutMs}
                      onChange={(event) => setTimeoutMs(event.target.value)}
                      suffix={<Text variant="caption" tone="muted">ms</Text>}
                    />
                  </Field>
                  <Field label="Idempotency" description="How a retry decides it has already run.">
                    <Select
                      value={idempotency}
                      onValueChange={setIdempotency}
                      options={[
                        { value: "input_hash", label: "Input hash", description: "Same input, same call" },
                        { value: "idempotency_key", label: "Idempotency key", description: "Caller supplies the key" },
                        { value: "none", label: "None", description: "Every retry executes again" },
                      ]}
                    />
                  </Field>
                </div>
                {idempotency === "none" && (method !== "GET" || type === "database") ? (
                  <ModalNote tone="warning" title="Retries will duplicate this call">
                    Without an idempotency strategy, a retried write runs twice. Pick input hash unless
                    the endpoint is genuinely safe to repeat.
                  </ModalNote>
                ) : null}
              </ModalSection>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="grid gap-4">
              <ModalSection title="What will be registered">
                <SummaryList>
                  <SummaryRow label="Name" onEdit={() => setStep(0)}>{trimmedName}</SummaryRow>
                  <SummaryRow label="Adapter" onEdit={() => setStep(0)}>{spec.label}</SummaryRow>
                  <SummaryRow label="Connection" onEdit={() => setStep(1)}>
                    {connectionId
                      ? connections.find((connection) => connection.id === connectionId)?.name ?? connectionId
                      : "None"}
                  </SummaryRow>
                  {type === "http" ? (
                    <SummaryRow label="Endpoint" mono onEdit={() => setStep(2)}>
                      {operation ? `${method} ${operationUrl}` : http.requestSummary(httpSpec)}
                    </SummaryRow>
                  ) : null}
                  {type === "database" ? (
                    <SummaryRow label="Statement" mono onEdit={() => setStep(2)}>
                      {sqlTemplate.trim()}
                    </SummaryRow>
                  ) : null}
                  <SummaryRow label="Risk" onEdit={() => setStep(3)}>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-1.5 rounded-full",
                          RISK_TIERS.find((tier) => tier.value === risk)?.markerClassName,
                        )}
                      />
                      {RISK_TIERS.find((tier) => tier.value === risk)?.label}
                      {requiresApproval ? " · approval required" : " · no approval gate"}
                    </span>
                  </SummaryRow>
                  <SummaryRow label="Timeout" mono onEdit={() => setStep(3)}>
                    {timeoutValue.toLocaleString()} ms
                  </SummaryRow>
                  <SummaryRow label="Lifecycle" onEdit={() => setStep(0)}>
                    {lifecycle[0]!.toUpperCase() + lifecycle.slice(1)}
                  </SummaryRow>
                </SummaryList>
              </ModalSection>

              <ModalSection
                title="Pre-flight"
                description="Validates the exact configuration below against the API. Nothing is executed and nothing is written."
                aside={
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={validating}
                    loadingLabel="Validating"
                    onClick={() => void validate()}
                    iconLeft={<Icon icon={ShieldCheck} size="sm" decorative />}
                  >
                    Validate configuration
                  </Button>
                }
              >
                {validation ? (
                  <ModalNote
                    tone={validation.valid ? "success" : "danger"}
                    title={validation.valid ? "Configuration is valid" : "Configuration was rejected"}
                  >
                    {validation.message}
                  </ModalNote>
                ) : (
                  <ModalNote title="Not validated yet">
                    Optional, but it catches an unreachable host or an incompatible connection before a
                    row exists.
                  </ModalNote>
                )}
              </ModalSection>

              {create.error ? (
                <ModalNote tone="danger" title="The tool was not registered">
                  {create.error.message}
                  {create.error.requestId ? (
                    <span className="mt-1 flex items-center gap-1.5">
                      Request <MonoId value={create.error.requestId} head={8} tail={4} />
                    </span>
                  ) : null}
                </ModalNote>
              ) : null}
            </div>
          ) : null}
        </ModalBody>

        <ModalFooter
          hint={
            error ? (
              <span className="flex items-start gap-1.5">
                <Icon icon={WarningCircle} size="sm" decorative className="text-status-waiting mt-px" />
                <Text variant="caption" tone="muted" className="leading-snug">{error}</Text>
              </span>
            ) : step === STEPS.length - 1 ? (
              <span className="flex items-center gap-1.5">
                <Icon icon={CheckCircle} size="sm" decorative className="text-status-success" />
                <Text variant="caption" tone="muted">Ready to register.</Text>
              </span>
            ) : null
          }
        >
          {step > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setStep((current) => current - 1)}
              iconLeft={<Icon icon={ArrowLeft} size="sm" decorative />}
            >
              Back
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}

          {step < STEPS.length - 1 ? (
            <Button
              variant="primary"
              size="sm"
              disabled={Boolean(error)}
              onClick={() => setStep((current) => current + 1)}
              iconRight={<Icon icon={ArrowRight} size="sm" decorative />}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              loadingLabel="Registering"
              disabled={!complete}
              onClick={() => create.mutate()}
              iconLeft={<Icon icon={Plus} size="sm" decorative />}
            >
              Register tool
            </Button>
          )}
        </ModalFooter>
      </ModalLayout>
    </Modal>
  );
}
