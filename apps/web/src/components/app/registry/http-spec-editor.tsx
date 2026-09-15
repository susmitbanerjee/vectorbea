"use client";

import * as React from "react";
import {
  Plus, Trash, WarningCircle, Info, LockKey, ArrowsClockwise, Function,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Checkbox } from "~/components/ui/choice";
import * as spec from "~/lib/tools/http-spec";
import type { SpecDocument, SpecInput } from "~/lib/tools/http-spec";

/* ══════════════════════════════════════════════════════════════════════════════
   THE HTTP TOOL EDITOR

   The acceptance criterion this screen exists for, verbatim: "A POST with a JSON
   body, an api_key header, and a nested response extraction is configurable
   entirely through the UI with no code."

   Every clause of that is a section below, and none of them is a JSON textarea.
   A textarea IS code — it has a syntax to get wrong, no affordances, and no way
   to tell you that the path needs `{customerId}` and nothing supplies it.

   ── THE TWO-NAME COLUMN IS THE POINT OF THE INPUTS TABLE ────────────────────
   Every input has an AGENT NAME and a WIRE NAME, and the table shows both side
   by side because they answer to different audiences. `startingAfter` is what a
   model reads well; `starting_after` is what Stripe reads at all. The previous
   resolver had one name, so either the model read the vendor's abbreviations or
   the vendor never received the parameter.

   ── BOUND VALUES ARE A SECURITY CONTROL, NOT A CONVENIENCE ──────────────────
   An input with a bound value is not in the schema the model sees, cannot be
   supplied by it, and is always sent. That is the difference between "list MY
   organisation's repositories" and "list any organisation's repositories", and
   therefore between a tool that is safe to grant and one that is not. It is
   marked in the table rather than hidden in a detail panel.

   ── WHAT THE FORM WILL NOT LET YOU EXPRESS ──────────────────────────────────
   A credential. Auth names FIELDS of the connection's secret (`secret.apiKey`),
   never values, and the API refuses a document carrying anything that looks like
   one. The reason is that this document is returned by the list endpoint,
   snapshotted into every version and shown in re-import diffs — so a secret in
   it would be a secret in all four.
══════════════════════════════════════════════════════════════════════════════ */

export function HttpSpecEditor({
  value,
  onChange,
  connectionBaseUrl,
  disabled = false,
  className,
}: {
  value: SpecDocument | null | undefined;
  onChange: (next: SpecDocument) => void;
  /** Shown so the author can see the URL their path will be joined onto. */
  connectionBaseUrl?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const doc = value ?? spec.emptySpec();
  const set = React.useCallback(
    (keyPath: readonly string[], next: unknown) => onChange(spec.setIn(doc, keyPath, next)),
    [doc, onChange],
  );

  const problems = spec.specProblems(doc);
  const unmapped = spec.unmappedPathParams(doc);

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <RequestSection doc={doc} set={set} disabled={disabled} baseUrl={connectionBaseUrl} unmapped={unmapped} />
      <InputsSection doc={doc} set={set} disabled={disabled} unmapped={unmapped} />
      <BodySection doc={doc} set={set} disabled={disabled} />
      <AuthSection doc={doc} set={set} disabled={disabled} />
      <ResponseSection doc={doc} set={set} disabled={disabled} />
      <PaginationSection doc={doc} set={set} disabled={disabled} />
      <ReliabilitySection doc={doc} set={set} disabled={disabled} />
      <TransportSection doc={doc} set={set} disabled={disabled} />

      {problems.length > 0 ? (
        <div
          className="border-status-failed-border bg-status-failed-subtle rounded-md border p-3"
          role="status"
        >
          <div className="flex items-center gap-2">
            <Icon icon={WarningCircle} size="sm" decorative className="text-status-failed" />
            <Text variant="body-sm" className="text-fg-primary font-medium">
              {problems.length === 1
                ? "One thing would stop this tool working"
                : `${problems.length} things would stop this tool working`}
            </Text>
          </div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {problems.map((problem) => (
              <li key={problem}>
                <Text variant="body-sm" tone="secondary">{problem}</Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ── Section chrome ───────────────────────────────────────────────────────── */

type Setter = (keyPath: readonly string[], next: unknown) => void;

function Section({
  title, description, children, icon,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  icon?: import("~/components/icons/types").IconComponent;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {icon ? <Icon icon={icon} size="sm" decorative className="text-fg-muted" /> : null}
          <Text variant="label" className="text-fg-max">{title}</Text>
        </div>
        {description ? (
          <Text variant="body-sm" tone="secondary">{description}</Text>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Note({ tone = "info", children }: { tone?: "info" | "warning"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-sm border p-2.5",
        tone === "warning"
          ? "border-status-degraded-border bg-status-degraded-subtle"
          : "border-subtle bg-surface-sunken",
      )}
    >
      <Icon
        icon={tone === "warning" ? WarningCircle : Info}
        size="sm"
        decorative
        className={tone === "warning" ? "text-status-degraded mt-0.5" : "text-fg-muted mt-0.5"}
      />
      <Text variant="body-sm" tone="secondary">{children}</Text>
    </div>
  );
}

/* ── Request ──────────────────────────────────────────────────────────────── */

function RequestSection({
  doc, set, disabled, baseUrl, unmapped,
}: {
  doc: SpecDocument; set: Setter; disabled: boolean;
  baseUrl?: string | null; unmapped: string[];
}) {
  const method = spec.method(doc);
  const path = spec.path(doc);
  const override = String(spec.request(doc).baseUrl ?? "");

  return (
    <Section
      title="Request"
      description="The call this tool makes. A relative path is joined onto the connection's base URL; an absolute one is used as written."
    >
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <Field label="Method">
          <Select
            value={method}
            onValueChange={(next) => set(["request", "method"], next)}
            options={spec.HTTP_METHODS.map((m) => ({ value: m, label: m }))}
            disabled={disabled}
            aria-label="HTTP method"
          />
        </Field>
        <Field
          label="Path"
          description="Placeholders are written {likeThis} and filled from inputs mapped to the path."
          error={
            unmapped.length > 0
              ? `Nothing supplies ${unmapped.map((n) => `{${n}}`).join(", ")}. Add a path input with that wire name.`
              : undefined
          }
        >
          <Input
            value={path}
            onChange={(e) => set(["request", "path"], e.target.value)}
            placeholder="/v1/customers/{id}/notes"
            disabled={disabled}
            className="font-code"
          />
        </Field>
      </div>

      <Field
        label="Base URL override"
        description="Leave empty to use the connection's. Set it only when this one operation lives somewhere else."
      >
        <Input
          value={override}
          onChange={(e) => set(["request", "baseUrl"], e.target.value.trim() || undefined)}
          placeholder={baseUrl ?? "https://api.example.com"}
          disabled={disabled}
          className="font-code"
        />
      </Field>

      <div className="border-subtle bg-surface-sunken rounded-sm border px-3 py-2">
        <Text variant="caption" tone="muted">Sends</Text>
        <Text variant="body-sm" className="font-code text-fg-primary mt-0.5 break-all">
          {method} {override || baseUrl || "…"}{path}
        </Text>
      </div>
    </Section>
  );
}

/* ── Inputs ───────────────────────────────────────────────────────────────── */

function InputsSection({
  doc, set, disabled, unmapped,
}: {
  doc: SpecDocument; set: Setter; disabled: boolean; unmapped: string[];
}) {
  const inputs = spec.inputs(doc);

  const update = (index: number, patch: Partial<SpecInput>) => {
    const next = inputs.map((input, i) => (i === index ? { ...input, ...patch } : input));
    set(["request", "inputs"], next);
  };
  const remove = (index: number) => set(["request", "inputs"], inputs.filter((_, i) => i !== index));
  const add = (location: SpecInput["in"], wireName = "") =>
    set(["request", "inputs"], [
      ...inputs,
      { name: wireName || "", in: location, wireName: wireName || undefined, type: "string", required: location === "path" },
    ]);

  return (
    <Section
      title="Inputs"
      description="What the agent may supply, and where each value lands on the wire. The two names are separate on purpose — the model reads one and the service reads the other."
    >
      {inputs.length === 0 ? (
        <div className="border-subtle rounded-md border border-dashed p-6 text-center">
          <Text variant="body-sm" tone="secondary">
            No inputs yet. This tool sends the same request every time.
          </Text>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {inputs.map((input, index) => (
            <InputRow
              key={`${input.name}-${index}`}
              input={input}
              disabled={disabled}
              highlight={input.in === "path" && unmapped.includes(input.wireName ?? input.name)}
              onChange={(patch) => update(index, patch)}
              onRemove={() => remove(index)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {spec.INPUT_LOCATIONS.map((location) => (
          <Button
            key={location}
            variant="secondary"
            size="sm"
            iconLeft={<Icon icon={Plus} size="sm" decorative />}
            disabled={disabled}
            onClick={() => add(location)}
          >
            {location === "path" ? "Path" : location === "query" ? "Query" :
              location === "header" ? "Header" : location === "body" ? "Body field" : "Cookie"}
          </Button>
        ))}
        {unmapped.length > 0 ? (
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Icon icon={Plus} size="sm" decorative />}
            disabled={disabled}
            onClick={() => add("path", unmapped[0])}
          >
            Add {`{${unmapped[0]}}`}
          </Button>
        ) : null}
      </div>
    </Section>
  );
}

function InputRow({
  input, onChange, onRemove, disabled, highlight,
}: {
  input: SpecInput;
  onChange: (patch: Partial<SpecInput>) => void;
  onRemove: () => void;
  disabled: boolean;
  highlight: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const bound = input.constant !== undefined && input.constant !== null;

  return (
    <div
      className={cn(
        "rounded-md border p-3",
        highlight ? "border-status-degraded-border bg-status-degraded-subtle" : "border-subtle bg-surface-raised",
      )}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_120px_110px_auto]">
        <Field label="Agent name" description="What the model is shown.">
          <Input
            value={input.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="customerId"
            disabled={disabled}
            className="font-code"
          />
        </Field>
        <Field label="Wire name" description="What the service receives.">
          <Input
            value={input.wireName ?? ""}
            onChange={(e) => onChange({ wireName: e.target.value || undefined })}
            placeholder={input.name || "id"}
            disabled={disabled}
            className="font-code"
          />
        </Field>
        <Field label="In">
          <Select
            value={input.in}
            onValueChange={(next) => onChange({ in: next as SpecInput["in"] })}
            options={spec.INPUT_LOCATIONS.map((l) => ({ value: l, label: l }))}
            disabled={disabled}
            aria-label="Where this input lands"
          />
        </Field>
        <Field label="Type">
          <Select
            value={input.type ?? "string"}
            onValueChange={(next) => onChange({ type: next })}
            options={spec.INPUT_TYPES.map((t) => ({ value: t, label: t }))}
            disabled={disabled}
            aria-label="Input type"
          />
        </Field>
        <div className="flex items-end pb-1">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            iconLeft={<Icon icon={Trash} size="sm" decorative />}
            aria-label={`Remove input ${input.name || "unnamed"}`}
            disabled={disabled}
            onClick={onRemove}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4">
        <Checkbox
          checked={input.required ?? false}
          onCheckedChange={(next) => onChange({ required: next === true })}
          disabled={disabled || input.in === "path"}
        >{input.in === "path" ? "Required (a path value always is)" : "Required"}</Checkbox>
        <Checkbox
          checked={bound}
          onCheckedChange={(next) => onChange({ constant: next === true ? "" : undefined })}
          disabled={disabled}
        >{"Bound to a fixed value"}</Checkbox>
        {input.in === "body" ? (
          <Checkbox
            checked={input.isFile ?? false}
            onCheckedChange={(next) => onChange({ isFile: next === true || undefined })}
            disabled={disabled}
          >{"This is a file"}</Checkbox>
        ) : null}
        <button
          type="button"
          className="text-fg-link font-ui text-caption underline-offset-2 hover:underline focus-visible:outline-border-focus focus-visible:rounded-xs focus-visible:outline focus-visible:outline-2"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Fewer options" : "More options"}
        </button>
      </div>

      {bound ? (
        <div className="mt-2">
          <Field
            label="Bound value"
            description="Sent every time. Not offered to the model, so it cannot be talked out of this scope."
          >
            <Input
              value={String(input.constant ?? "")}
              onChange={(e) => onChange({ constant: e.target.value })}
              disabled={disabled}
              className="font-code"
            />
          </Field>
        </div>
      ) : null}

      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Description" description="Shown to the model. One line beats none.">
            <Input
              value={input.description ?? ""}
              onChange={(e) => onChange({ description: e.target.value || undefined })}
              disabled={disabled}
            />
          </Field>
          <Field label="Default" description="Used when the model omits an optional input.">
            <Input
              value={String(input.default ?? "")}
              onChange={(e) => onChange({ default: e.target.value || undefined })}
              disabled={disabled}
              className="font-code"
            />
          </Field>
          {input.in === "body" ? (
            <Field
              label="Body path"
              description="Dotted, for a nested body: customer.address.line1. Defaults to the wire name."
            >
              <Input
                value={input.bodyPath ?? ""}
                onChange={(e) => onChange({ bodyPath: e.target.value || undefined })}
                placeholder={input.wireName ?? input.name}
                disabled={disabled}
                className="font-code"
              />
            </Field>
          ) : null}
          {input.type === "array" ? (
            <Field
              label="Array serialisation"
              description="Explode sends a=1&a=2; joined sends a=1,2. Getting this wrong makes a filter silently match nothing."
            >
              <Select
                value={(input.explode ?? true) ? "explode" : "joined"}
                onValueChange={(next) => onChange({ explode: next === "explode" })}
                options={[
                  { value: "explode", label: "Repeat the parameter" },
                  { value: "joined", label: "Join with commas" },
                ]}
                disabled={disabled}
                aria-label="Array serialisation"
              />
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ── Body ─────────────────────────────────────────────────────────────────── */

const ENCODING_LABEL: Record<spec.BodyEncoding, string> = {
  none: "No body",
  json: "JSON",
  form: "Form encoded",
  multipart: "Multipart (file upload)",
  raw: "Raw text",
  passthrough: "One input, sent whole",
};

const DEFAULT_CONTENT_TYPE: Record<spec.BodyEncoding, string> = {
  none: "",
  json: "application/json",
  form: "application/x-www-form-urlencoded",
  multipart: "multipart/form-data",
  raw: "text/plain",
  passthrough: "application/octet-stream",
};

function BodySection({ doc, set, disabled }: { doc: SpecDocument; set: Setter; disabled: boolean }) {
  const encoding = spec.bodyEncoding(doc);
  const contentType = spec.contentType(doc);
  const bodyInputs = spec.inputs(doc).filter((i) => i.in === "body");
  const isRead = ["GET", "HEAD"].includes(spec.method(doc));
  const template = (spec.request(doc).body as Record<string, unknown> | undefined)?.template;

  return (
    <Section
      title="Request body"
      description="How the body is built and what it is labelled as. Body inputs are assembled automatically; a template is only needed for a shape that is not a projection of arguments."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Encoding">
          <Select
            value={encoding}
            onValueChange={(next) => {
              const e = next as spec.BodyEncoding;
              if (e === "none") set(["request", "body"], undefined);
              else set(["request", "body"], {
                ...(spec.request(doc).body as Record<string, unknown> | undefined),
                encoding: e,
                contentType: DEFAULT_CONTENT_TYPE[e],
              });
            }}
            options={spec.BODY_ENCODINGS.map((e) => ({ value: e, label: ENCODING_LABEL[e] }))}
            disabled={disabled}
            aria-label="Body encoding"
          />
        </Field>
        {encoding !== "none" ? (
          <Field label="Content type" description="Sent as the Content-Type header.">
            <Input
              value={contentType}
              onChange={(e) => set(["request", "body", "contentType"], e.target.value)}
              placeholder={DEFAULT_CONTENT_TYPE[encoding]}
              disabled={disabled}
              className="font-code"
            />
          </Field>
        ) : null}
      </div>

      {encoding !== "none" && isRead ? (
        <Note tone="warning">
          {spec.method(doc)} requests do not carry a body. Change the method, or set the
          encoding to No body.
        </Note>
      ) : null}

      {encoding === "form" ? (
        <Note>
          Nested values are sent in bracket form — <code className="font-code">metadata[order_id]=42</code> —
          which is the only way a form-encoded body can express one. Stripe and everything
          that copied it read exactly this.
        </Note>
      ) : null}

      {template !== undefined ? <Field label="Request template" description="Placeholders are filled from agent inputs at runtime. This template is preserved when saving.">
        <Textarea mono readOnly autoGrow={false} minRows={5} value={typeof template === "string" ? template : JSON.stringify(template, null, 2)} />
      </Field> : null}
      {encoding !== "none" ? (
        <div className="border-subtle bg-surface-sunken rounded-sm border px-3 py-2">
          <Text variant="caption" tone="muted">
            Built from {bodyInputs.length} body input{bodyInputs.length === 1 ? "" : "s"}
          </Text>
          <Text variant="body-sm" className="font-code text-fg-secondary mt-0.5">
            {bodyInputs.length === 0
              ? "— add inputs mapped to the body"
              : bodyInputs.map((i) => i.bodyPath ?? i.wireName ?? i.name).join(", ")}
          </Text>
        </div>
      ) : null}
    </Section>
  );
}

/* ── Auth ─────────────────────────────────────────────────────────────────── */

const STRATEGY_LABEL: Record<spec.AuthStrategy, string> = {
  inherit: "Inherit from the connection",
  none: "None (public endpoint)",
  api_key_header: "API key in a header",
  api_key_query: "API key in a query parameter",
  bearer: "Bearer token",
  basic: "Basic (username and password)",
  oauth2_client_credentials: "OAuth2 — client credentials",
  oauth2_authorization_code: "OAuth2 — user authorised",
  hmac: "HMAC request signing",
  custom: "Custom headers",
};

function AuthSection({ doc, set, disabled }: { doc: SpecDocument; set: Setter; disabled: boolean }) {
  const strategy = spec.authStrategy(doc);
  const auth = spec.auth(doc);
  const field = (key: string, fallback = "") => String(auth[key] ?? fallback);

  return (
    <Section
      title="Authentication"
      icon={LockKey}
      description="How this tool proves who it is. The credential itself lives on the connection — everything here names a field of it."
    >
      <Field label="Strategy">
        <Select
          value={strategy}
          onValueChange={(next) => set(["auth"], { strategy: next })}
          options={spec.AUTH_STRATEGIES.map((s) => ({ value: s, label: STRATEGY_LABEL[s] }))}
          disabled={disabled}
          aria-label="Authentication strategy"
        />
      </Field>

      {strategy === "api_key_header" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Header name"
            description="The service decides this. api_key, X-API-Key and Authorization are all real."
          >
            <Input
              value={field("header", "X-API-Key")}
              onChange={(e) => set(["auth", "header"], e.target.value)}
              disabled={disabled}
              className="font-code"
            />
          </Field>
          <Field label="Prefix" description="Written before the key, with a space. Usually empty.">
            <Input
              value={field("prefix")}
              onChange={(e) => set(["auth", "prefix"], e.target.value)}
              placeholder="(none)"
              disabled={disabled}
              className="font-code"
            />
          </Field>
        </div>
      ) : null}

      {strategy === "api_key_query" ? (
        <>
          <Field label="Query parameter name">
            <Input
              value={field("param", "api_key")}
              onChange={(e) => set(["auth", "param"], e.target.value)}
              disabled={disabled}
              className="font-code"
            />
          </Field>
          <Note tone="warning">
            A key in a URL is recorded by every proxy it passes and by the provider&apos;s own
            access log. The runtime keeps it out of our events, spans, traces and logs, but it
            cannot keep it out of theirs. Prefer a header when the service offers one.
          </Note>
        </>
      ) : null}

      {strategy === "bearer" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Header name">
            <Input
              value={field("header", "Authorization")}
              onChange={(e) => set(["auth", "header"], e.target.value)}
              disabled={disabled}
              className="font-code"
            />
          </Field>
          <Field label="Prefix">
            <Input
              value={field("prefix", "Bearer")}
              onChange={(e) => set(["auth", "prefix"], e.target.value)}
              disabled={disabled}
              className="font-code"
            />
          </Field>
        </div>
      ) : null}

      {strategy === "basic" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username" description="Not a secret. The password comes from the connection.">
            <Input
              value={field("username")}
              onChange={(e) => set(["auth", "username"], e.target.value)}
              disabled={disabled}
            />
          </Field>
          <Field
            label="Password field"
            description="Which field of the connection's credential holds the password."
          >
            <Input
              value={field("passwordSecretField", "value")}
              onChange={(e) => set(["auth", "passwordSecretField"], e.target.value)}
              disabled={disabled}
              className="font-code"
            />
          </Field>
        </div>
      ) : null}

      {strategy === "oauth2_client_credentials" || strategy === "oauth2_authorization_code" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Token URL">
              <Input
                value={field("tokenUrl")}
                onChange={(e) => set(["auth", "tokenUrl"], e.target.value)}
                placeholder="https://auth.example.com/oauth/token"
                disabled={disabled}
                className="font-code"
              />
            </Field>
            <Field label="Client id" description="Identifies; does not authenticate. Not a secret.">
              <Input
                value={field("clientId")}
                onChange={(e) => set(["auth", "clientId"], e.target.value)}
                disabled={disabled}
                className="font-code"
              />
            </Field>
          </div>
          <Field
            label="Scopes"
            description="Space separated. Ask for what this one tool needs, not for everything."
          >
            <Input
              value={(Array.isArray(auth.scopes) ? (auth.scopes as string[]) : []).join(" ")}
              onChange={(e) =>
                set(["auth", "scopes"], e.target.value.split(/\s+/).filter(Boolean))
              }
              disabled={disabled}
              className="font-code"
            />
          </Field>
          {strategy === "oauth2_authorization_code" ? (
            <Note>
              This grant is delegated by a PERSON. The runtime can spend and refresh the token
              but cannot obtain the first one — the connection must already carry an access and
              refresh token. When the refresh token is revoked, the agent is told to stop rather
              than to retry.
            </Note>
          ) : null}
        </>
      ) : null}

      {strategy === "hmac" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Algorithm">
              <Select
                value={field("algorithm", "HmacSHA256")}
                onValueChange={(next) => set(["auth", "algorithm"], next)}
                options={["HmacSHA256", "HmacSHA512", "HmacSHA1"].map((a) => ({ value: a, label: a }))}
                disabled={disabled}
                aria-label="HMAC algorithm"
              />
            </Field>
            <Field label="Signature header">
              <Input
                value={field("signatureHeader", "X-Signature")}
                onChange={(e) => set(["auth", "signatureHeader"], e.target.value)}
                disabled={disabled}
                className="font-code"
              />
            </Field>
          </div>
          <Field
            label="Canonical string"
            description="Built from: {{method}} {{path}} {{query}} {{host}} {{timestamp}} {{nonce}} {{body}} {{bodySha256Hex}} {{bodySha256Base64}}"
          >
            <Input
              value={field("canonicalTemplate", "{{method}}\n{{path}}\n{{timestamp}}\n{{bodySha256Hex}}")}
              onChange={(e) => set(["auth", "canonicalTemplate"], e.target.value)}
              disabled={disabled}
              className="font-code"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Timestamp header" description="Omitting it is the usual cause of a signature the service rejects.">
              <Input
                value={field("timestampHeader", "X-Timestamp")}
                onChange={(e) => set(["auth", "timestampHeader"], e.target.value || undefined)}
                disabled={disabled}
                className="font-code"
              />
            </Field>
            <Field label="Digest encoding">
              <Select
                value={field("encoding", "hex")}
                onValueChange={(next) => set(["auth", "encoding"], next)}
                options={[
                  { value: "hex", label: "Hex" },
                  { value: "base64", label: "Base64" },
                  { value: "base64url", label: "Base64 URL-safe" },
                ]}
                disabled={disabled}
                aria-label="Digest encoding"
              />
            </Field>
          </div>
        </>
      ) : null}

      {strategy === "custom" ? (
        <Note>
          Custom headers see <code className="font-code">{"{{secret.<field>}}"}</code> and nothing
          else — not the agent&apos;s arguments, and not the request body. An auth header built
          from a model-supplied value is a header the model controls. Anything the agent should
          influence belongs in Inputs, mapped to a header.
        </Note>
      ) : null}

      {strategy === "inherit" ? (
        <Note>
          Uses the connection&apos;s own auth type. Existing tools keep this, and keep behaving
          exactly as they do. Choose a strategy above when the service needs a name this cannot
          express.
        </Note>
      ) : null}
    </Section>
  );
}

/* ── Response ─────────────────────────────────────────────────────────────── */

function ResponseSection({ doc, set, disabled }: { doc: SpecDocument; set: Setter; disabled: boolean }) {
  const response = spec.response(doc);
  const extract = spec.extraction(doc);
  const expected = Array.isArray(response.expectedStatus) ? (response.expectedStatus as number[]) : [];
  const errors = Array.isArray(response.errors) ? (response.errors as Record<string, unknown>[]) : [];

  return (
    <Section
      title="Response"
      icon={Function}
      description="What counts as success, and what the agent is shown. Extraction narrows the document; the result contract narrows the fields within it."
    >
      <Field
        label="Success statuses"
        description="Comma separated. Empty means any 2xx. Declare 404 here when 'not found' is an answer rather than a failure."
      >
        <Input
          value={expected.join(", ")}
          onChange={(e) => {
            const parsed = e.target.value
              .split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
            set(["response", "expectedStatus"], parsed.length > 0 ? parsed : undefined);
          }}
          placeholder="200, 201, 204"
          disabled={disabled}
          className="font-code tabular-nums"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <Field label="Extraction">
          <Select
            value={extract.engine}
            onValueChange={(next) => {
              if (next === "none") set(["response", "extract"], undefined);
              else set(["response", "extract"], { engine: next, expression: extract.expression });
            }}
            options={[
              { value: "none", label: "Whole response" },
              { value: "jsonpath", label: "JSONPath" },
              { value: "jmespath", label: "JMESPath" },
            ]}
            disabled={disabled}
            aria-label="Extraction engine"
          />
        </Field>
        {extract.engine !== "none" ? (
          <Field
            label="Expression"
            description="Cuts the envelope away before the model sees it. An expression that matches nothing falls back to the whole response rather than to an empty one."
          >
            <Input
              value={extract.expression}
              onChange={(e) => set(["response", "extract", "expression"], e.target.value)}
              placeholder={extract.engine === "jsonpath" ? "$.data.result" : "data.result"}
              disabled={disabled}
              className="font-code"
            />
          </Field>
        ) : (
          <div className="flex items-end pb-2">
            <Text variant="body-sm" tone="muted">
              The agent sees everything the endpoint returns, capped.
            </Text>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Text variant="label" className="text-fg-secondary">Error rules</Text>
        <Text variant="body-sm" tone="secondary">
          Standard statuses are already classified correctly. Add a rule to override that —
          a vendor returning 200 with an error body, or a 403 that really means rate limited.
        </Text>
        {errors.map((rule, index) => (
          <div key={index} className="border-subtle bg-surface-raised rounded-md border p-3">
            <div className="grid gap-2 sm:grid-cols-[110px_1fr_1fr_auto]">
              <Field label="Status">
                <Input
                  value={String(rule.status ?? "")}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const next = errors.map((r, i) =>
                      i === index ? { ...r, status: Number.isFinite(n) && e.target.value ? n : undefined } : r);
                    set(["response", "errors"], next);
                  }}
                  placeholder="any"
                  disabled={disabled}
                  className="font-code tabular-nums"
                />
              </Field>
              <Field label="Body says false at" description="For {&quot;ok&quot;: false} on a 200.">
                <Input
                  value={String(rule.whenBodyFalse ?? "")}
                  onChange={(e) => {
                    const next = errors.map((r, i) =>
                      i === index ? { ...r, whenBodyFalse: e.target.value || undefined } : r);
                    set(["response", "errors"], next);
                  }}
                  placeholder="ok"
                  disabled={disabled}
                  className="font-code"
                />
              </Field>
              <Field label="Kind">
                <Select
                  value={String(rule.kind ?? "unknown")}
                  onValueChange={(nextKind) => {
                    const next = errors.map((r, i) => (i === index ? { ...r, kind: nextKind } : r));
                    set(["response", "errors"], next);
                  }}
                  options={["auth", "not_found", "invalid_input", "rate_limit", "server", "unknown"]
                    .map((k) => ({ value: k, label: k.replace("_", " ") }))}
                  disabled={disabled}
                  aria-label="Error kind"
                />
              </Field>
              <div className="flex items-end pb-1">
                <Button
                  variant="ghost" size="sm" iconOnly iconLeft={<Icon icon={Trash} size="sm" decorative />}
                  aria-label={`Remove error rule ${index + 1}`}
                  disabled={disabled}
                  onClick={() => set(["response", "errors"], errors.filter((_, i) => i !== index))}
                />
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="Message path" description="Where the provider puts its own message.">
                <Input
                  value={String(rule.messagePath ?? "")}
                  onChange={(e) => {
                    const next = errors.map((r, i) =>
                      i === index ? { ...r, messagePath: e.target.value || undefined } : r);
                    set(["response", "errors"], next);
                  }}
                  placeholder="error.message"
                  disabled={disabled}
                  className="font-code"
                />
              </Field>
              <Field label="How to fix it" description="Read by the agent. Say what would actually work.">
                <Input
                  value={String(rule.fix ?? "")}
                  onChange={(e) => {
                    const next = errors.map((r, i) =>
                      i === index ? { ...r, fix: e.target.value || undefined } : r);
                    set(["response", "errors"], next);
                  }}
                  disabled={disabled}
                />
              </Field>
            </div>
            <div className="mt-2">
              <Checkbox
                checked={rule.retryable === true}
                onCheckedChange={(next) => {
                  const updated = errors.map((r, i) =>
                    i === index ? { ...r, retryable: next === true } : r);
                  set(["response", "errors"], updated);
                }}
                disabled={disabled}
              >{"Trying the same thing again could work"}</Checkbox>
            </div>
          </div>
        ))}
        <div>
          <Button
            variant="secondary" size="sm" iconLeft={<Icon icon={Plus} size="sm" decorative />} disabled={disabled}
            onClick={() => set(["response", "errors"], [...errors, { kind: "unknown", retryable: false }])}
          >
            Add error rule
          </Button>
        </div>
      </div>
    </Section>
  );
}

/* ── Pagination ───────────────────────────────────────────────────────────── */

function PaginationSection({ doc, set, disabled }: { doc: SpecDocument; set: Setter; disabled: boolean }) {
  const strategy = spec.paginationStrategy(doc);
  const page = spec.pagination(doc);
  const field = (key: string, fallback = "") => String(page[key] ?? fallback);

  return (
    <Section
      title="Pagination"
      description="An agent handed a cursor will follow it until the context window ends the run. Declaring the strategy moves the loop into the runtime, where the bound is a number."
    >
      <Field label="Strategy">
        <Select
          value={strategy}
          onValueChange={(next) => {
            if (next === "none") set(["pagination"], undefined);
            else set(["pagination"], { ...page, strategy: next, maxPages: page.maxPages ?? 5, maxItems: page.maxItems ?? 200 });
          }}
          options={[
            { value: "none", label: "None — one request" },
            { value: "cursor", label: "Cursor" },
            { value: "offset", label: "Offset and limit" },
            { value: "page", label: "Page number" },
            { value: "link_header", label: "Link header (RFC 8288)" },
          ]}
          disabled={disabled}
          aria-label="Pagination strategy"
        />
      </Field>

      {strategy !== "none" ? (
        <>
          <Field
            label="Items path"
            description="Dotted path to the array of records. Pages are accumulated here."
          >
            <Input
              value={field("itemsPath")}
              onChange={(e) => set(["pagination", "itemsPath"], e.target.value || undefined)}
              placeholder="data"
              disabled={disabled}
              className="font-code"
            />
          </Field>

          {strategy === "cursor" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cursor parameter" description="Carries the position on the next request.">
                <Input
                  value={field("cursorParam")}
                  onChange={(e) => set(["pagination", "cursorParam"], e.target.value)}
                  placeholder="starting_after"
                  disabled={disabled}
                  className="font-code"
                />
              </Field>
              <Field label="Next cursor path" description="Where the next cursor is in this response.">
                <Input
                  value={field("nextCursorPath")}
                  onChange={(e) => set(["pagination", "nextCursorPath"], e.target.value)}
                  placeholder="next_cursor"
                  disabled={disabled}
                  className="font-code"
                />
              </Field>
              <Field
                label="Has-more path"
                description="Wins over the cursor. Some APIs return a cursor on the last page too, and following it loops forever."
              >
                <Input
                  value={field("hasMorePath")}
                  onChange={(e) => set(["pagination", "hasMorePath"], e.target.value || undefined)}
                  placeholder="has_more"
                  disabled={disabled}
                  className="font-code"
                />
              </Field>
              <Field label="Limit parameter">
                <Input
                  value={field("limitParam")}
                  onChange={(e) => set(["pagination", "limitParam"], e.target.value || undefined)}
                  placeholder="limit"
                  disabled={disabled}
                  className="font-code"
                />
              </Field>
            </div>
          ) : null}

          {strategy === "offset" || strategy === "page" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={strategy === "page" ? "Page parameter" : "Offset parameter"}>
                <Input
                  value={field("offsetParam", strategy === "page" ? "page" : "offset")}
                  onChange={(e) => set(["pagination", "offsetParam"], e.target.value)}
                  disabled={disabled}
                  className="font-code"
                />
              </Field>
              <Field label="Limit parameter">
                <Input
                  value={field("limitParam", "limit")}
                  onChange={(e) => set(["pagination", "limitParam"], e.target.value || undefined)}
                  disabled={disabled}
                  className="font-code"
                />
              </Field>
              <Field label="Page size">
                <Input
                  type="number"
                  value={field("pageSize", "50")}
                  onChange={(e) => set(["pagination", "pageSize"], Number(e.target.value) || 50)}
                  disabled={disabled}
                  className="tabular-nums"
                />
              </Field>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Maximum pages"
              description="Bounds the requests. An API with ten-item pages needs this one."
            >
              <Input
                type="number"
                value={field("maxPages", "5")}
                onChange={(e) => set(["pagination", "maxPages"], Number(e.target.value) || 5)}
                disabled={disabled}
                className="tabular-nums"
              />
            </Field>
            <Field
              label="Maximum items"
              description="Bounds the tokens. An API with thousand-item pages needs this one."
            >
              <Input
                type="number"
                value={field("maxItems", "200")}
                onChange={(e) => set(["pagination", "maxItems"], Number(e.target.value) || 200)}
                disabled={disabled}
                className="tabular-nums"
              />
            </Field>
          </div>
          <Note>
            When a cap stops the walk the agent is told so, with a count. A model shown a
            cut-off list with no marker reasons as though it saw everything, and answers
            confidently and wrongly.
          </Note>
        </>
      ) : null}
    </Section>
  );
}

/* ── Reliability ──────────────────────────────────────────────────────────── */

function ReliabilitySection({ doc, set, disabled }: { doc: SpecDocument; set: Setter; disabled: boolean }) {
  const retry = spec.retry(doc);
  const idem = (spec.setIn(doc, [], doc).idempotency ?? {}) as Record<string, unknown>;
  const isWrite = !["GET", "HEAD", "OPTIONS", "TRACE"].includes(spec.method(doc));
  const retryWrites = retry.retryWrites === true;

  return (
    <Section
      title="Timeout, retry and idempotency"
      icon={ArrowsClockwise}
      description="A retry without jitter means every worker that failed at the same moment retries at the same moment, and knocks the provider over as it recovers."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Timeout (ms)" description="Total call, including the body.">
          <Input
            type="number"
            value={String(doc.timeoutMs ?? "")}
            onChange={(e) => set(["timeoutMs"], Number(e.target.value) || undefined)}
            placeholder="30000"
            disabled={disabled}
            className="tabular-nums"
          />
        </Field>
        <Field label="Attempts">
          <Input
            type="number"
            value={String(retry.maxAttempts ?? 3)}
            onChange={(e) => set(["retry", "maxAttempts"], Number(e.target.value) || 3)}
            disabled={disabled}
            className="tabular-nums"
          />
        </Field>
        <Field label="Jitter">
          <Select
            value={String(retry.jitter ?? "full")}
            onValueChange={(next) => set(["retry", "jitter"], next)}
            options={[
              { value: "full", label: "Full — spread widest" },
              { value: "equal", label: "Equal — half fixed" },
              { value: "none", label: "None" },
            ]}
            disabled={disabled}
            aria-label="Retry jitter"
          />
        </Field>
      </div>

      {isWrite ? (
        <>
          <Checkbox
            checked={retryWrites}
            onCheckedChange={(next) => set(["retry", "retryWrites"], next === true)}
            disabled={disabled}
          >
            Retry this {spec.method(doc)} on a transient failure
          </Checkbox>
          <Note tone={retryWrites ? "warning" : "info"}>
            A {spec.method(doc)} that timed out may already have been received. The runtime
            retries one only when an idempotency key is also being sent, so the provider
            deduplicates it — otherwise a retry is a second charge, and the pairing is enforced
            rather than trusted to this checkbox.
          </Note>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Idempotency">
              <Select
                value={String(idem.mode ?? "auto")}
                onValueChange={(next) => set(["idempotency", "mode"], next)}
                options={[
                  { value: "auto", label: "Send the key on writes" },
                  { value: "none", label: "Never send it" },
                ]}
                disabled={disabled}
                aria-label="Idempotency mode"
              />
            </Field>
            <Field label="Header name">
              <Input
                value={String(idem.header ?? "Idempotency-Key")}
                onChange={(e) => set(["idempotency", "header"], e.target.value)}
                disabled={disabled}
                className="font-code"
              />
            </Field>
          </div>
        </>
      ) : null}
    </Section>
  );
}

/* ── Transport ────────────────────────────────────────────────────────────── */

function TransportSection({ doc, set, disabled }: { doc: SpecDocument; set: Setter; disabled: boolean }) {
  const transport = spec.transport(doc);
  const [open, setOpen] = React.useState(
    () => Object.keys(transport).length > 0,
  );
  const mtls = (transport.mtls ?? {}) as Record<string, unknown>;
  const proxy = (transport.proxy ?? {}) as Record<string, unknown>;

  if (!open) {
    return (
      <Section title="Transport" description="For a private network: a client certificate, a private CA, an egress proxy, or an SNI that differs from the host.">
        <div>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
            Configure transport
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Transport"
      description="For a private network. Certificate material is referenced by secret, never pasted here."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Client certificate secret"
          description="The reference, not the certificate. Store the PEM as a secret first."
        >
          <Input
            value={String(mtls.clientCertSecretRef ?? "")}
            onChange={(e) => set(["transport", "mtls", "clientCertSecretRef"], e.target.value || undefined)}
            disabled={disabled}
            className="font-code"
          />
        </Field>
        <Field label="Client key secret" description="PKCS#8. Also a reference.">
          <Input
            value={String(mtls.clientKeySecretRef ?? "")}
            onChange={(e) => set(["transport", "mtls", "clientKeySecretRef"], e.target.value || undefined)}
            disabled={disabled}
            className="font-code"
          />
        </Field>
      </div>

      <Field
        label="CA bundle (PEM)"
        description="A CA certificate is public material, so it may be pasted. There is deliberately no option to skip verification."
      >
        <Input
          value={String(transport.caBundlePem ?? "")}
          onChange={(e) => set(["transport", "caBundlePem"], e.target.value || undefined)}
          placeholder="-----BEGIN CERTIFICATE-----"
          disabled={disabled}
          className="font-code"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Proxy host">
          <Input
            value={String(proxy.host ?? "")}
            onChange={(e) => set(["transport", "proxy", "host"], e.target.value || undefined)}
            disabled={disabled}
            className="font-code"
          />
        </Field>
        <Field label="Proxy port">
          <Input
            type="number"
            value={String(proxy.port ?? "")}
            onChange={(e) => set(["transport", "proxy", "port"], Number(e.target.value) || undefined)}
            disabled={disabled}
            className="tabular-nums"
          />
        </Field>
        <Field label="Proxy credential secret">
          <Input
            value={String(proxy.credentialSecretRef ?? "")}
            onChange={(e) => set(["transport", "proxy", "credentialSecretRef"], e.target.value || undefined)}
            disabled={disabled}
            className="font-code"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="SNI" description="Selects the certificate the server presents.">
          <Input
            value={String(transport.sni ?? "")}
            onChange={(e) => set(["transport", "sni"], e.target.value || undefined)}
            disabled={disabled}
            className="font-code"
          />
        </Field>
        <Field label="Host header" description="Selects the virtual host it routes to. Not the same thing.">
          <Input
            value={String(transport.hostHeader ?? "")}
            onChange={(e) => set(["transport", "hostHeader"], e.target.value || undefined)}
            disabled={disabled}
            className="font-code"
          />
        </Field>
      </div>
    </Section>
  );
}
