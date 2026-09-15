"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { contracts } from "@vectorbea/shared";
import {
  ArrowSquareOut, CheckCircle, Key, MagnifyingGlass, Plugs, SignIn,
} from "@phosphor-icons/react/dist/ssr";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/choice";
import { ProviderLogo } from "~/components/ui/provider-logo";
import {
  Modal, ModalBody, ModalFooter, ModalHeader, ModalLayout, ModalNote, ModalRail,
  ModalSection, ModalStepBar, type ModalStep,
} from "~/components/ui/modal";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import type { McpProbeResult, McpToolRow } from "~/lib/api/client";
import { useMcpSignIn } from "./use-mcp-sign-in";

/* ══════════════════════════════════════════════════════════════════════════════
   CONNECT AN MCP SERVER

   ── THE WHOLE FLOW IS: PASTE A URL ──────────────────────────────────────────
   The previous wizard was the generic connection wizard with an MCP branch: pick
   an auth method, type a token, test, then save, then press Discover, then go to
   each agent and tick boxes. For a hosted server that uses OAuth — which is most
   of the servers anybody wants — the token step had no right answer, the test
   failed with "the server rejected the token", and the only way forward was
   "Save without verifying".

   This is how connecting a remote MCP server works in Claude and Claude Code,
   and every decision after the URL is made by asking the server:

     1. Server    Paste the URL. We probe it.
     2. Connect   No credential needed → connected. Sign-in published → one
                  button, a window, done. Neither → paste a token.
     3. Tools     Discovered on the way in — the person arrives at a list.
     4. Agents    Pick which agents use them. Written as N explicit tool ids per
                  agent, which is still the only grant the engine can express
                  (MCP.md §3): there is no "whole server" grant to create, and
                  the button says how many tools it is adding.

   ── WHY THE SIGN-IN LISTENS THREE WAYS ──────────────────────────────────────
   The authorization server is someone else's page, and many set
   Cross-Origin-Opener-Policy, which severs `window.opener` for the rest of the
   popup's life. So the completion page (`/mcp/oauth/complete`) reports back by
   `postMessage` when it can, by a `localStorage` write (which fires a `storage`
   event in this tab regardless of opener), and this dialog also polls the
   connection as a last resort. Any one of the three is enough.
══════════════════════════════════════════════════════════════════════════════ */

const STEPS: ModalStep[] = [
  { id: "server", label: "Server", summary: "Paste its URL" },
  { id: "connect", label: "Connect", summary: "Sign in if it asks" },
  { id: "tools", label: "Tools", summary: "What it offers" },
  { id: "agents", label: "Agents", summary: "Who can use them" },
];

/**
 * A handful of well-known remote servers, as a starting point.
 *
 * Suggestions, not integrations: each one fills the URL field and nothing else,
 * and the probe decides what happens next exactly as it does for a URL somebody
 * typed. Kept short on purpose — a directory that is wrong about one vendor's
 * URL teaches people not to trust the rest.
 */
const SUGGESTED: { name: string; url: string; provider: string }[] = [
  /* The read-only endpoint on purpose: it exposes no tool that can write to a
     repository, which is the right default for a server an agent reads code
     through. GitHub needs a personal access token — see the probe. */
  { name: "GitHub", url: "https://api.githubcopilot.com/mcp/readonly", provider: "github" },
  { name: "Linear", url: "https://mcp.linear.app/mcp", provider: "linear" },
  { name: "Notion", url: "https://mcp.notion.com/mcp", provider: "notion" },
  { name: "Sentry", url: "https://mcp.sentry.dev/mcp", provider: "sentry" },
  { name: "Higgsfield", url: "https://mcp.higgsfield.ai/mcp", provider: "higgsfield" },
];

type Phase =
  | { kind: "idle" }
  | { kind: "probing" }
  | { kind: "probed"; probe: McpProbeResult }
  | { kind: "signing-in"; url: string | null; blocked: boolean }
  | { kind: "failed"; message: string };

export function ConnectMcpDialog({
  open, onOpenChange, onCreated, onBack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (connection: contracts.Connection) => void;
  /** Present when this was reached from the provider picker. */
  onBack?: () => void;
}) {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();
  const readScope = React.useMemo(() => ({ workspaceId: scope.workspaceId, environmentId: null }), [scope.workspaceId]);

  const [step, setStep] = React.useState(0);
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [nameTouched, setNameTouched] = React.useState(false);
  const [token, setToken] = React.useState("");
  const [useToken, setUseToken] = React.useState(false);
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [saved, setSaved] = React.useState<contracts.Connection | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [tools, setTools] = React.useState<McpToolRow[] | null>(null);
  const [toolsError, setToolsError] = React.useState<string | null>(null);
  const [loadingTools, setLoadingTools] = React.useState(false);

  const trimmedUrl = url.trim();
  const urlError = validateUrl(trimmedUrl);
  const probe = phase.kind === "probed" ? phase.probe : null;
  const busy = saving || phase.kind === "probing" || loadingTools;

  /* Name follows the URL until somebody edits it. It becomes the prefix on every
     tool this server contributes, so it is worth getting right, and a host name
     is a better default than "MCP server — 2026". */
  React.useEffect(() => {
    if (nameTouched) return;
    setName(defaultName(trimmedUrl));
  }, [trimmedUrl, nameTouched]);

  const finish = React.useCallback(() => {
    if (saved) onCreated?.(saved);
    onOpenChange(false);
  }, [saved, onCreated, onOpenChange]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.connections.all(readScope) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tools.all(readScope) });
  }

  // ── Probe ─────────────────────────────────────────────────────────────────

  async function runProbe(withToken?: string) {
    if (urlError) return;
    setPhase({ kind: "probing" });
    setStep(1);
    try {
      const result = await api.connections.mcpProbe({ serverUrl: trimmedUrl, token: withToken || null }, readScope);
      setPhase({ kind: "probed", probe: result });
      if (result.auth === "token" && result.status !== "connected") setUseToken(true);
    } catch (error) {
      setPhase({ kind: "failed", message: messageOf(error, "The server could not be checked. Try again in a moment.") });
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function ensureSaved(auth: "none" | "oauth2" | "bearer", secret?: string): Promise<contracts.Connection> {
    /* Already saved — usually by a sign-in attempt that did not work out. Update
       it to the method now being used, or a token typed afterwards would never be
       stored and the server would be connected with no credential at all. */
    if (saved) {
      if (saved.authType === auth && !secret) return saved;
      const updated = await api.connections.update(saved.id, {
        authType: auth,
        ...(secret ? { plaintextSecret: secret } : {}),
      }, readScope);
      setSaved(updated);
      invalidate();
      return updated;
    }
    const connection = await api.connections.create({
      name: name.trim() || defaultName(trimmedUrl),
      type: "mcp",
      provider: "mcp",
      authType: auth,
      environment: "production",
      config: { serverUrl: trimmedUrl, transport: "streamable-http" },
      ...(secret ? { plaintextSecret: secret } : {}),
    }, readScope);
    setSaved(connection);
    invalidate();
    return connection;
  }

  /** Switch to pasting a token, from wherever the person is — including a failure. */
  function switchToToken(reason?: string) {
    signInFlow.cancel();
    setUseToken(true);
    setPhase({
      kind: "probed",
      probe: {
        status: "failed",
        errorCode: "TOKEN_REQUIRED",
        message: reason ?? "Paste an access token for this server.",
        latencyMs: 0,
        auth: "token",
        serverName: null,
        authorizationServer: probe?.authorizationServer ?? null,
        toolCount: null,
      },
    });
  }

  async function connectDirect() {
    setSaving(true);
    try {
      const credential = useToken ? token.trim() : "";
      const connection = await ensureSaved(credential ? "bearer" : "none", credential || undefined);
      await discoverAndList(connection.id);
    } catch (error) {
      setPhase({ kind: "failed", message: messageOf(error, "The server could not be saved.") });
    } finally {
      setSaving(false);
    }
  }

  // ── Sign in ───────────────────────────────────────────────────────────────

  const signInFlow = useMcpSignIn(readScope, (outcome) => {
    if (outcome.status === "ok") void discoverAndList(outcome.connectionId, { alreadyDiscovered: true });
    else setPhase({ kind: "failed", message: signInFailureCopy(outcome.reason) });
  });

  async function signIn() {
    setSaving(true);
    try {
      let connectionId: string | null = null;
      const required = await signInFlow.start(async () => {
        connectionId = (await ensureSaved("oauth2")).id;
        return connectionId;
      });
      if (!required && connectionId) await discoverAndList(connectionId);
    } catch (error) {
      /* The only thing left to try is a token, so offer it with the reason rather
         than a dead end that says "Check again". */
      switchToToken(messageOf(error, "The sign-in could not be started."));
    } finally {
      setSaving(false);
    }
  }

  /* The hook owns the in-flight state; the step renders from it. */
  const shownPhase: Phase = signInFlow.pending
    ? { kind: "signing-in", url: signInFlow.pending.url, blocked: signInFlow.pending.blocked }
    : phase;

  // ── Tools ─────────────────────────────────────────────────────────────────

  async function discoverAndList(connectionId: string, opts: { alreadyDiscovered?: boolean } = {}) {
    setLoadingTools(true);
    setToolsError(null);
    setStep(2);
    try {
      if (!opts.alreadyDiscovered) {
        const outcome = await api.connections.mcpDiscover(connectionId, readScope);
        if (outcome.toolsFound === 0 && outcome.lastError) setToolsError(outcome.lastError);
      }
      const listed = await api.connections.mcpTools(connectionId, readScope);
      /* A sign-in that discovered nothing (discovery off, or it failed after the
         credential was stored) gets one explicit attempt here, so the person
         never lands on an empty list that would have been full on a retry. */
      if (listed.items.length === 0 && opts.alreadyDiscovered) {
        const outcome = await api.connections.mcpDiscover(connectionId, readScope);
        if (outcome.toolsFound === 0 && outcome.lastError) setToolsError(outcome.lastError);
        setTools((await api.connections.mcpTools(connectionId, readScope)).items);
      } else {
        setTools(listed.items);
      }
      invalidate();
      setPhase({ kind: "idle" });
    } catch (error) {
      setToolsError(messageOf(error, "The server's tools could not be read."));
      setTools([]);
    } finally {
      setLoadingTools(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const liveTools = (tools ?? []).filter((t) => !t.possiblyWithdrawn);
  const reachable = saved ? (tools ? 3 : 2) : phase.kind === "idle" && step === 0 ? 0 : 1;

  const rail: ModalStep[] = STEPS.map((entry, index) => ({
    ...entry,
    value:
      index === 0 ? (trimmedUrl && !urlError ? hostOf(trimmedUrl) : undefined)
        : index === 1 ? (saved ? "Connected" : probe ? probeLabel(probe) : undefined)
          : index === 2 ? (tools ? `${liveTools.length} tool${liveTools.length === 1 ? "" : "s"}` : undefined)
            : undefined,
  }));

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next && !saving) finish(); }}
      dismissible={!saving}
      size="xl"
    >
      <ModalHeader
        eyebrow="Connect · Integrations"
        title="Connect an MCP server"
        description="Paste the server's URL. If it uses sign-in you'll sign in once; its tools are discovered as soon as it connects."
        mark={<Icon icon={Plugs} size="md" decorative />}
        closeDisabled={saving}
      />
      <ModalStepBar steps={rail} activeIndex={step} reachableIndex={reachable} onSelect={(i) => { if (i <= reachable && !saved) setStep(i); else if (saved && i >= 2 && i <= reachable) setStep(i); }} />
      <ModalLayout
        rail={
          <ModalRail
            eyebrow="New MCP server"
            steps={rail}
            activeIndex={step}
            reachableIndex={reachable}
            onSelect={(i) => { if (saved ? i >= 2 && i <= reachable : i <= reachable) setStep(i); }}
            footnote="Credentials and sign-ins are encrypted at rest and never returned by the API."
          />
        }
      >
        <ModalBody>
          {step === 0 ? (
            <ServerStep
              url={url}
              onUrl={(next) => { setUrl(next); setPhase({ kind: "idle" }); }}
              urlError={trimmedUrl ? urlError : null}
              name={name}
              onName={(next) => { setName(next); setNameTouched(true); }}
              onSubmit={() => void runProbe()}
            />
          ) : null}

          {step === 1 ? (
            <ConnectStep
              host={hostOf(trimmedUrl)}
              phase={shownPhase}
              saving={saving}
              useToken={useToken}
              onUseToken={setUseToken}
              token={token}
              onToken={setToken}
              onRetest={() => void runProbe(useToken ? token.trim() : undefined)}
              onSignIn={() => void signIn()}
              onTokenInstead={() => switchToToken()}
            />
          ) : null}

          {step === 2 ? (
            <ToolsStep
              serverName={name.trim() || hostOf(trimmedUrl)}
              loading={loadingTools}
              tools={tools}
              error={toolsError}
              onRetry={() => { if (saved) void discoverAndList(saved.id); }}
            />
          ) : null}

          {step === 3 && saved && tools ? (
            <AgentsStep
              tools={liveTools}
              serverName={name.trim() || hostOf(trimmedUrl)}
              onDone={finish}
            />
          ) : null}
        </ModalBody>

        <ModalFooter
          hint={step === 1 && probe?.status === "connected" ? (
            <span className="flex items-center gap-1.5">
              <Icon icon={CheckCircle} size="sm" decorative className="text-status-success" />
              <Text variant="caption" tone="muted">{probe.message}</Text>
            </span>
          ) : null}
        >
          {step === 0 ? (
            <Button variant="ghost" size="sm" onClick={() => (onBack ? onBack() : onOpenChange(false))}>
              {onBack ? "Back" : "Cancel"}
            </Button>
          ) : step === 1 && !saved ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setStep(0); setPhase({ kind: "idle" }); }}>
              Back
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled={saving} onClick={finish}>
              Close
            </Button>
          )}

          {step === 0 ? (
            <Button variant="primary" size="sm" disabled={Boolean(urlError)} onClick={() => void runProbe()}>
              Continue
            </Button>
          ) : step === 1 ? (
            <ConnectPrimary
              phase={shownPhase}
              saving={saving}
              useToken={useToken}
              token={token}
              onConnect={() => void connectDirect()}
              onRetest={() => void runProbe(useToken ? token.trim() : undefined)}
            />
          ) : step === 2 ? (
            <Button
              variant="primary"
              size="sm"
              disabled={loadingTools || liveTools.length === 0}
              onClick={() => setStep(3)}
            >
              Choose agents
            </Button>
          ) : null}
        </ModalFooter>
      </ModalLayout>
    </Modal>
  );
}

/* ── Steps ────────────────────────────────────────────────────────────────── */

function ServerStep({
  url, onUrl, urlError, name, onName, onSubmit,
}: {
  url: string;
  onUrl: (next: string) => void;
  urlError: string | null;
  name: string;
  onName: (next: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-5">
      <ModalSection title="Server URL" description="The server's streamable-HTTP endpoint. It usually ends in /mcp.">
        <Field label="Server URL" labelHidden error={urlError ?? undefined}>
          <Input
            value={url}
            autoFocus
            mono
            placeholder="https://mcp.example.com/mcp"
            onChange={(event) => onUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !urlError) onSubmit(); }}
          />
        </Field>
      </ModalSection>

      <ModalSection title="Or start from a known server">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SUGGESTED.map((entry) => (
            <button
              key={entry.url}
              type="button"
              onClick={() => onUrl(entry.url)}
              className={cn(
                "border-subtle bg-surface-raised flex min-w-0 items-center gap-2.5 rounded-md border px-3 py-2 text-left",
                "hover:bg-surface-hover active:bg-surface-active transition-colors duration-fast outline-none focus-visible:focus-ring",
                url.trim() === entry.url && "border-accent-border bg-accent-subtle",
              )}
            >
              <ProviderLogo provider={entry.provider} fallbackLabel={entry.name} size={18} decorative className="shrink-0" />
              <span className="min-w-0">
                <Text variant="body-sm" tone="primary" className="block">{entry.name}</Text>
                <Text variant="mono-sm" tone="muted" className="block truncate">{entry.url}</Text>
              </span>
            </button>
          ))}
        </div>
      </ModalSection>

      <ModalSection title="Name" description="Prefixes every tool this server adds, so it's what you'll read in an agent's tool list.">
        <Field label="Name" labelHidden>
          <Input value={name} maxLength={80} onChange={(event) => onName(event.target.value)} placeholder="Linear" />
        </Field>
      </ModalSection>
    </div>
  );
}

function ConnectStep({
  host, phase, saving, useToken, onUseToken, token, onToken, onRetest, onSignIn, onTokenInstead,
}: {
  host: string;
  phase: Phase;
  saving: boolean;
  useToken: boolean;
  onUseToken: (next: boolean) => void;
  token: string;
  onToken: (next: string) => void;
  onRetest: () => void;
  onSignIn: () => void;
  onTokenInstead: () => void;
}) {
  if (phase.kind === "probing") {
    return (
      <div className="grid grid-cols-1 gap-3">
        <ModalNote title={`Checking ${host}`}>
          Asking the server who it is, what it offers, and whether it needs you to sign in.
        </ModalNote>
        <span className="bg-surface-sunken block h-16 rounded-md" aria-hidden />
      </div>
    );
  }

  if (phase.kind === "signing-in") {
    return (
      <div className="grid grid-cols-1 gap-3">
        <ModalNote title={phase.blocked ? "Your browser blocked the sign-in window" : "Finish signing in in the other window"}>
          {phase.blocked
            ? "Open the sign-in page yourself. This screen continues on its own when you're done."
            : "This screen continues on its own once you've approved access. If you closed the window, open it again."}
        </ModalNote>
        <div className="flex flex-wrap gap-2">
          {phase.url ? (
            <Button asChild size="sm" variant="secondary" iconLeft={<Icon icon={ArrowSquareOut} size="sm" decorative />}>
              <a href={phase.url} target="_blank" rel="noopener noreferrer">Open the sign-in page</a>
            </Button>
          ) : null}
          {/* A sign-in can fail on the other side — an organisation that blocks
              third-party apps, an account without access — and nothing reports
              that back here. Waiting forever is not an answer. */}
          <Button size="sm" variant="ghost" onClick={onTokenInstead} iconLeft={<Icon icon={Key} size="sm" decorative />}>
            Use an access token instead
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === "failed") {
    return (
      <div className="grid grid-cols-1 gap-3">
        <ModalNote tone="danger" title="Not connected">{phase.message}</ModalNote>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onRetest}>Check again</Button>
          {/* Every failure can still be answered with a token — a sign-in that
              broke, a server that is picky about sign-in, a probe that timed out. */}
          <Button size="sm" variant="ghost" onClick={onTokenInstead} iconLeft={<Icon icon={Key} size="sm" decorative />}>
            Use an access token instead
          </Button>
        </div>
      </div>
    );
  }

  const probe = phase.kind === "probed" ? phase.probe : null;
  if (!probe) return null;

  if (probe.status === "connected" && !useToken) {
    return (
      <ModalNote tone="success" title={probe.serverName ? `${probe.serverName} is ready` : "The server is ready"}>
        {probe.auth === "none"
          ? `No sign-in needed. ${countSentence(probe.toolCount)} Add it to discover them.`
          : `${countSentence(probe.toolCount)} Add it to discover them.`}
      </ModalNote>
    );
  }

  if (probe.auth === "oauth" && !useToken) {
    return (
      <div className="grid grid-cols-1 gap-4">
        <div className="border-subtle bg-surface-raised grid place-items-center rounded-lg border px-4 py-8 text-center">
          <Icon icon={SignIn} size="lg" decorative className="text-fg-secondary" />
          <Text variant="heading-sm" tone="max" as="p" className="mt-2 block">
            {host} uses sign-in
          </Text>
          <Text variant="body-sm" tone="secondary" className="mt-1 block max-w-[48ch] leading-snug">
            Sign in{probe.authorizationServer ? ` with ${probe.authorizationServer}` : ""} and approve access. Vectorbea
            registers itself with the server, so there&rsquo;s no OAuth app to create and no token to copy.
          </Text>
          <div className="mt-4">
            <Button variant="primary" size="sm" loading={saving} loadingLabel="Starting sign-in" onClick={onSignIn}
              iconLeft={<Icon icon={SignIn} size="sm" decorative />}>
              Sign in
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onUseToken(true)}
          className="text-accent font-ui text-caption justify-self-start rounded-xs outline-none hover:underline focus-visible:focus-ring"
        >
          Use an access token instead
        </button>
      </div>
    );
  }

  /* A token: the server asked for one, or the person chose to use one. */
  return (
    <div className="grid grid-cols-1 gap-4">
      {probe.status !== "connected" ? (
        <ModalNote
          tone={probe.errorCode === "AUTH_FAILED" || probe.auth !== "token" ? "danger" : "neutral"}
          title={probe.errorCode === "AUTH_FAILED"
            ? "That token was rejected"
            : probe.auth === "token" ? "This server needs an access token" : "Not connected"}
        >
          {probe.message}
        </ModalNote>
      ) : null}
      <Field
        label="Access token"
        description="Sent as a bearer token. Encrypted when saved and never shown again."
      >
        <Input
          type="password"
          autoComplete="off"
          mono
          value={token}
          onChange={(event) => onToken(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && token.trim()) onRetest(); }}
          prefix={<Icon icon={Key} size="sm" decorative />}
        />
      </Field>
      {probe.auth === "oauth" ? (
        <button
          type="button"
          onClick={() => onUseToken(false)}
          className="text-accent font-ui text-caption justify-self-start rounded-xs outline-none hover:underline focus-visible:focus-ring"
        >
          Sign in instead
        </button>
      ) : null}
    </div>
  );
}

function ConnectPrimary({
  phase, saving, useToken, token, onConnect, onRetest,
}: {
  phase: Phase;
  saving: boolean;
  useToken: boolean;
  token: string;
  onConnect: () => void;
  onRetest: () => void;
}) {
  if (phase.kind === "probing" || phase.kind === "signing-in") {
    return <Button variant="primary" size="sm" loading loadingLabel="Waiting">Connect</Button>;
  }
  if (phase.kind === "failed") {
    return <Button variant="primary" size="sm" onClick={onRetest}>Check again</Button>;
  }
  const probe = phase.kind === "probed" ? phase.probe : null;
  if (!probe) return null;

  if (useToken) {
    /* Verify the token before saving it: a stored token that does not work is
       a connection that fails at an agent's first tool call instead of here. */
    return probe.status === "connected" && token.trim() ? (
      <Button variant="primary" size="sm" loading={saving} loadingLabel="Adding" onClick={onConnect}
        iconLeft={<Icon icon={CheckCircle} size="sm" decorative />}>
        Add server
      </Button>
    ) : (
      <Button variant="primary" size="sm" disabled={!token.trim()} onClick={onRetest}>Check token</Button>
    );
  }
  if (probe.status === "connected") {
    return (
      <Button variant="primary" size="sm" loading={saving} loadingLabel="Adding" onClick={onConnect}
        iconLeft={<Icon icon={CheckCircle} size="sm" decorative />}>
        Add server
      </Button>
    );
  }
  /* The sign-in button lives in the body, beside what it signs in to. A second
     primary "Sign in" in the footer was two identical calls to action on one
     screen. */
  if (probe.auth === "oauth") return null;
  return <Button variant="primary" size="sm" onClick={onRetest}>Check again</Button>;
}

function ToolsStep({
  serverName, loading, tools, error, onRetry,
}: {
  serverName: string;
  loading: boolean;
  tools: McpToolRow[] | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading || tools === null) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <ModalNote title={`Discovering ${serverName}'s tools`}>
          Asking the server for its tool list and registering each one.
        </ModalNote>
        <ul className="grid grid-cols-1 gap-1.5" aria-hidden>
          {[0, 1, 2, 3].map((row) => (
            <li key={row} className="flex items-center gap-2">
              <span className="bg-surface-sunken h-3.5 w-44 shrink-0 rounded-xs" />
              <span className="bg-surface-sunken h-3.5 min-w-0 flex-1 rounded-xs" />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const live = tools.filter((t) => !t.possiblyWithdrawn);

  if (live.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <ModalNote tone={error ? "danger" : "neutral"} title={error ? "The tools could not be discovered" : "This server offers no tools yet"}>
          {error ?? "It connected and its tool list is empty. Discover again once the server publishes some."}
        </ModalNote>
        <div><Button size="sm" variant="secondary" onClick={onRetry} iconLeft={<Icon icon={MagnifyingGlass} size="sm" decorative />}>Discover again</Button></div>
      </div>
    );
  }

  return (
    <ModalSection
      title={`${live.length} tool${live.length === 1 ? "" : "s"} from ${serverName}`}
      description="Each is now in your tool registry. Next, choose which agents can use them."
    >
      <ul className="border-subtle divide-subtle divide-y rounded-md border">
        {live.map((tool) => (
          <li key={tool.toolId} className="flex min-w-0 items-start gap-2.5 px-3 py-2">
            <Icon icon={Plugs} size="sm" decorative className="text-fg-muted mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <Text variant="mono-sm" tone="primary" className="block truncate">{tool.mcpToolName ?? tool.name}</Text>
              <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
                {tool.description ?? "No description."}
              </Text>
            </span>
          </li>
        ))}
      </ul>
    </ModalSection>
  );
}

/**
 * Hand the tools to agents, in one step.
 *
 * Writes each chosen agent's `allowedToolIds` as its existing grants plus these
 * tool ids — N explicit ids, never a reference to the server. The button names
 * the count so what the person does matches what is stored.
 */
function AgentsStep({
  tools, serverName, onDone,
}: {
  tools: McpToolRow[];
  serverName: string;
  onDone: () => void;
}) {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();
  const readScope = React.useMemo(() => ({ workspaceId: scope.workspaceId, environmentId: null }), [scope.workspaceId]);
  const keyScope = { workspaceId: scope.workspaceId, environmentId: null };

  const agents = useApiQuery({
    queryKey: queryKeys.agents.list(keyScope, { page: 1, pageSize: 200 }),
    queryFn: () => api.agents.list({ ...readScope, page: 1, pageSize: 200 }),
    enabled: Boolean(scope.workspaceId),
  });

  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<number | null>(null);

  const toolIds = tools.map((t) => t.toolId);
  const rows = agents.data?.items ?? [];

  async function grant() {
    setSaving(true);
    setError(null);
    const failed: string[] = [];
    for (const agent of rows.filter((a) => chosen.has(a.id))) {
      try {
        const next = Array.from(new Set([...(agent.allowedToolIds ?? []), ...toolIds]));
        await api.agents.update(agent.id, { allowedToolIds: next }, readScope);
      } catch {
        failed.push(agent.name);
      }
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.agents.all(readScope) });
    setSaving(false);
    if (failed.length > 0) {
      setError(`${failed.join(", ")} could not be updated. The others have the tools. Try again, or grant them from the agent's Tool grants tab.`);
    } else {
      setDone(chosen.size);
    }
  }

  if (done !== null) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <ModalNote tone="success" title={`${done} agent${done === 1 ? " can" : "s can"} now use ${serverName}`}>
          {tools.length} tool{tools.length === 1 ? " was" : "s were"} added to each. Calls are checked against these grants
          at run time, and any tool marked as needing approval still pauses for it.
        </ModalNote>
        <div><Button size="sm" variant="primary" onClick={onDone}>Done</Button></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <ModalSection
        title="Which agents should use these tools?"
        description={`Adds all ${tools.length} of ${serverName}'s tools to each agent you pick. You can remove any of them later from the agent's Tool grants tab.`}
      >
        {agents.isPending ? (
          <span className="bg-surface-sunken block h-24 rounded-md" aria-hidden />
        ) : agents.error ? (
          <ModalNote tone="danger" title="Agents could not be loaded">{agents.error.message}</ModalNote>
        ) : rows.length === 0 ? (
          <ModalNote title="No agents yet">
            The tools are registered. Create an agent and pick them on its Tool grants step.
          </ModalNote>
        ) : (
          <ul className="border-subtle divide-subtle max-h-72 divide-y overflow-y-auto rounded-md border">
            {rows.map((agent) => {
              const has = toolIds.every((id) => agent.allowedToolIds?.includes(id));
              return (
                <li key={agent.id} className="px-3 py-2">
                  <Checkbox
                    checked={has || chosen.has(agent.id)}
                    disabled={has || saving}
                    onCheckedChange={(value) => setChosen((current) => {
                      const next = new Set(current);
                      if (value === true) next.add(agent.id); else next.delete(agent.id);
                      return next;
                    })}
                    description={has ? "Already has these tools." : undefined}
                  >
                    {agent.name}
                  </Checkbox>
                </li>
              );
            })}
          </ul>
        )}
      </ModalSection>

      {error ? <ModalNote tone="danger" title="Not every agent was updated">{error}</ModalNote> : null}

      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          disabled={chosen.size === 0}
          loading={saving}
          loadingLabel="Adding tools"
          onClick={() => void grant()}
          iconLeft={<Icon icon={CheckCircle} size="sm" decorative />}
        >
          {chosen.size === 0
            ? "Add tools to agents"
            : `Add ${tools.length} tool${tools.length === 1 ? "" : "s"} to ${chosen.size} agent${chosen.size === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function validateUrl(value: string): string | null {
  if (!value) return "Enter the server's URL.";
  let parsed: URL;
  try { parsed = new URL(value); } catch { return "That isn't a URL. Include https://."; }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
    return "Use an https:// URL.";
  }
  return null;
}

function hostOf(value: string): string {
  try { return new URL(value).host; } catch { return "the server"; }
}

function defaultName(value: string): string {
  const known = SUGGESTED.find((entry) => entry.url === value);
  if (known) return known.name;
  try {
    const hostname = new URL(value).hostname;
    /* A host that names the product badly: `api.githubcopilot.com` is GitHub's
       MCP server, and "Githubcopilot" prefixed on every tool reads as a typo. */
    if (hostname === "api.githubcopilot.com") return "GitHub";
    const host = hostname.replace(/^(mcp|api|www)\./, "");
    const label = host.split(".")[0] ?? host;
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : "MCP server";
  } catch {
    return "MCP server";
  }
}

function probeLabel(probe: McpProbeResult): string {
  if (probe.status === "connected") return "Ready";
  if (probe.auth === "oauth") return "Needs sign-in";
  if (probe.auth === "token") return "Needs a token";
  return "Not reachable";
}

function countSentence(count: number | null): string {
  if (count == null) return "It answered.";
  if (count === 0) return "It offers no tools yet.";
  return `It offers ${count} tool${count === 1 ? "" : "s"}.`;
}

function signInFailureCopy(reason: string | undefined): string {
  switch (reason) {
    case "cancelled": return "You cancelled the sign-in. Sign in again when you're ready.";
    case "expired": return "The sign-in took too long and expired. Start it again.";
    case "exchange_failed": return "The server didn't accept the sign-in. Start it again; if it keeps failing, the server may not allow Vectorbea yet.";
    case "store_failed": return "The sign-in worked but couldn't be saved. Try again in a moment.";
    case "connection_deleted": return "This server was removed while you were signing in. Add it again.";
    default: return "The sign-in didn't complete. Start it again.";
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
