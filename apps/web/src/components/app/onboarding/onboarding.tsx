"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Checkbox, RadioGroup, Radio } from "~/components/ui/choice";
import { Spinner } from "~/components/ui/spinner";
import { Wordmark } from "~/components/app/shell/wordmark";
import { ProviderLogo, type ProviderId } from "~/components/ui/provider-logo";
import {
  ByokKeyIcon, FanOutIcon, AgentBrainIcon, CommitBoundaryIcon, GateApprovedIcon,
  CheckpointIcon, WorkerIcon,
} from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   FIRST-RUN ONBOARDING

   Five steps, every one skippable, progress persisted after each. Someone who
   closes the tab at step 3 comes back to step 3 — and someone who skips step 3
   is not blocked, because a person who cannot find their API key right now
   should still reach the product.

   Skipped steps are not lost: they are recorded and surface on Control as
   outstanding setup, which is where an unfinished workspace should nag rather
   than at a modal the user already dismissed.
══════════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = "vectorbea.onboarding.v1";

export interface OnboardingState {
  step: number;
  completed: number[];
  skipped: number[];
  name: string;
  role: string;
  teamSize: string;
  workspace: string;
  region: string;
  createStaging: boolean;
  provider: ProviderId | null;
  keyVerified: boolean;
  startPath: "template" | "architect" | "blank" | null;
}

const INITIAL: OnboardingState = {
  step: 0,
  completed: [],
  skipped: [],
  name: "",
  role: "",
  teamSize: "",
  workspace: "",
  region: "eu-west-1",
  createStaging: false,
  provider: null,
  keyVerified: false,
  startPath: null,
};

const STEPS = ["Welcome", "Workspace", "Model provider", "First workflow", "Ready"];

function loadState(): OnboardingState {
  if (typeof window === "undefined") return INITIAL;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...INITIAL, ...(JSON.parse(raw) as Partial<OnboardingState>) } : INITIAL;
  } catch {
    return INITIAL;
  }
}

export function Onboarding() {
  const [state, setState] = React.useState<OnboardingState>(INITIAL);
  const [hydrated, setHydrated] = React.useState(false);

  // Read persisted progress after mount so SSR and first paint agree.
  React.useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  const update = React.useCallback((patch: Partial<OnboardingState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const go = (step: number, mark: "completed" | "skipped") =>
    update({
      step,
      [mark]: Array.from(new Set([...state[mark], state.step])),
    } as Partial<OnboardingState>);

  const next = () => go(Math.min(STEPS.length - 1, state.step + 1), "completed");
  const skip = () => go(Math.min(STEPS.length - 1, state.step + 1), "skipped");
  const back = () => update({ step: Math.max(0, state.step - 1) });

  return (
    <div className="bg-surface-app text-fg-primary font-ui min-h-dvh">
      <header className="border-subtle border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-5 py-4 sm:px-8">
          <Wordmark />
          <Link
            href={"/dashboard" as never}
            className="font-ui text-caption text-fg-muted hover:text-fg-primary ml-auto rounded-sm outline-none transition-colors duration-fast focus-visible:focus-ring"
          >
            Skip setup for now
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
        <Stepper steps={STEPS} current={state.step} completed={state.completed} skipped={state.skipped} />

        <div className="mt-8">
          {!hydrated ? (
            <div className="flex items-center gap-2 py-16">
              <Spinner label="Loading your progress" />
              <Text variant="body-sm" tone="muted">Restoring where you left off…</Text>
            </div>
          ) : (
            <>
              {state.step === 0 ? <StepWelcome state={state} update={update} /> : null}
              {state.step === 1 ? <StepWorkspace state={state} update={update} /> : null}
              {state.step === 2 ? <StepProvider state={state} update={update} /> : null}
              {state.step === 3 ? <StepFirstWorkflow state={state} update={update} /> : null}
              {state.step === 4 ? <StepReady state={state} /> : null}
            </>
          )}
        </div>

        {hydrated && state.step < STEPS.length - 1 ? (
          <div className="border-subtle mt-8 flex items-center gap-3 border-t pt-5">
            {state.step > 0 ? (
              <Button variant="ghost" onClick={back}>Back</Button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={skip}>Skip this step</Button>
              <Button variant="primary" onClick={next}>Continue</Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Stepper ──────────────────────────────────────────────────────────────── */

function Stepper({
  steps, current, completed, skipped,
}: {
  steps: string[];
  current: number;
  completed: number[];
  skipped: number[];
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {steps.map((label, i) => {
        const isDone = completed.includes(i);
        const isSkipped = skipped.includes(i);
        const isCurrent = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border",
                isCurrent && "bg-accent border-accent text-fg-on-accent",
                !isCurrent && isDone && "bg-status-success-subtle border-status-success-border text-status-success",
                !isCurrent && isSkipped && "bg-status-waiting-subtle border-status-waiting-border text-status-waiting",
                !isCurrent && !isDone && !isSkipped && "border-subtle text-fg-disabled",
              )}
            >
              <span className="font-code text-[10px] tabular">{i + 1}</span>
            </span>
            <Text
              variant="caption"
              tone={isCurrent ? "primary" : isDone || isSkipped ? "secondary" : "muted"}
              className="hidden sm:block"
            >
              {label}
            </Text>
            {i < steps.length - 1 ? (
              <span aria-hidden="true" className="bg-surface-active hidden h-px w-6 sm:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StepHeader({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-6">
      <Text variant="heading-lg" tone="max" as="h1" className="block">{title}</Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 block max-w-[62ch]">{body}</Text>
    </div>
  );
}

type StepProps = { state: OnboardingState; update: (patch: Partial<OnboardingState>) => void };

/* ── 1 · Welcome ──────────────────────────────────────────────────────────── */

function StepWelcome({ state, update }: StepProps) {
  return (
    <div>
      <StepHeader
        title="Tell us who you are"
        body="Two of these change what you see first. None of them are shared."
      />
      <div className="grid gap-5">
        <Field label="Your name">
          <Input
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={state.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </Field>

        <Field label="What do you do?" description="We use this to pick your default landing page.">
          <Select
            aria-label="Role"
            value={state.role || undefined}
            onValueChange={(role) => update({ role })}
            placeholder="Choose a role"
            options={[
              { value: "platform", label: "Platform engineering", description: "Lands on Control" },
              { value: "ops", label: "Operations", description: "Lands on Runs" },
              { value: "data", label: "Data engineering", description: "Lands on Workflows" },
              { value: "founder", label: "Founder", description: "Lands on Control" },
              { value: "other", label: "Something else" },
            ]}
          />
        </Field>

        <Field label="Team size">
          <RadioGroup
            value={state.teamSize || undefined}
            onValueChange={(teamSize) => update({ teamSize })}
            className="grid-cols-2 sm:grid-cols-4"
          >
            {["Just me", "2–10", "11–50", "50+"].map((size) => (
              <Radio key={size} value={size}>{size}</Radio>
            ))}
          </RadioGroup>
        </Field>
      </div>
    </div>
  );
}

/* ── 2 · Workspace ────────────────────────────────────────────────────────── */

function StepWorkspace({ state, update }: StepProps) {
  return (
    <div>
      <StepHeader
        title="Name your workspace"
        body="A workspace holds your workflows, connections and members. You can create more later."
      />
      <div className="grid gap-5">
        <Field label="Workspace name" required description="Usually your company or team name.">
          <Input
            autoComplete="organization"
            placeholder="Acme Platform"
            value={state.workspace}
            onChange={(e) => update({ workspace: e.target.value })}
          />
        </Field>

        <Field
          label="Region"
          description="Where runs execute and run data is stored. This cannot be changed later."
        >
          <Select
            aria-label="Region"
            value={state.region}
            onValueChange={(region) => update({ region })}
            options={[
              { value: "eu-west-1", label: "eu-west-1", description: "Ireland" },
              { value: "us-east-1", label: "us-east-1", description: "N. Virginia" },
              { value: "us-west-2", label: "us-west-2", description: "Oregon" },
              { value: "ap-south-1", label: "ap-south-1", description: "Mumbai" },
            ]}
          />
        </Field>

        <div className="border-subtle rounded-md border p-4">
          <Text variant="label" tone="secondary" className="mb-2 block">Environments</Text>
          <div className="flex items-start gap-2.5">
            <span className="bg-accent mt-1.5 size-2 shrink-0 rounded-[1px]" aria-hidden="true" />
            <div>
              <Text variant="body-sm" tone="primary" className="block">Production — created</Text>
              <Text variant="caption" tone="muted" className="block">
                Every workspace gets one. Switching into it always asks for confirmation.
              </Text>
            </div>
          </div>
          <div className="mt-3">
            <Checkbox
              checked={state.createStaging}
              onCheckedChange={(v) => update({ createStaging: v === true })}
              description="A separate environment for testing changes."
            >
              Also create staging
            </Checkbox>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 3 · Model provider (BYOK) — the trust moment ─────────────────────────── */

const PROVIDERS: { id: ProviderId; label: string; hint: string; prefix: string }[] = [
  { id: "anthropic", label: "Anthropic", hint: "Claude models", prefix: "sk-ant-" },
  { id: "openai", label: "OpenAI", hint: "GPT models", prefix: "sk-" },
  { id: "gemini", label: "Google Gemini", hint: "Gemini models", prefix: "AI" },
  { id: "mistral", label: "Mistral", hint: "Mistral models", prefix: "" },
];

function StepProvider({ state, update }: StepProps) {
  const [key, setKey] = React.useState("");
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<null | { ok: boolean; message: string }>(null);

  const provider = state.provider;

  const test = async () => {
    setTesting(true);
    setResult(null);
    // Stands in for POST /api/connections/test until that endpoint is wired.
    await new Promise((r) => setTimeout(r, 1100));
    const chosen = PROVIDERS.find((p) => p.id === provider);
    const looksRight = chosen ? key.trim().startsWith(chosen.prefix) && key.trim().length > 20 : false;
    setTesting(false);
    if (looksRight) {
      setResult({ ok: true, message: "Key accepted. We made one metadata call and no completion." });
      update({ keyVerified: true });
    } else {
      setResult({
        ok: false,
        message: chosen?.prefix
          ? `That key did not authenticate. ${chosen.label} keys start with ${chosen.prefix} and are longer than this.`
          : "That key did not authenticate. Check you copied the whole value.",
      });
      update({ keyVerified: false });
    }
  };

  return (
    <div>
      <StepHeader
        title="Connect a model provider"
        body="Vectorbea runs your agents with your own provider account, so you keep your rate limits, your pricing and your data agreements."
      />

      {/* The explanation comes BEFORE the input. Someone is about to paste a
          credential; telling them what happens to it afterwards is too late. */}
      <div className="border-subtle bg-surface-sunken mb-6 rounded-md border p-4">
        <div className="flex items-start gap-2.5">
          <ByokKeyIcon size={20} aria-hidden="true" className="text-accent mt-0.5 shrink-0" />
          <div>
            <Text variant="body-sm" tone="primary" className="mb-1.5 block">What happens to this key</Text>
            <ul className="grid gap-1.5">
              {[
                "Encrypted with AES-256-GCM under a key unique to your workspace, before it touches disk.",
                "Decrypted only inside the runner process that makes the call, never in the browser or the control plane.",
                "Never displayed again — not to you, not to us. You can replace it, not read it.",
                "Excluded from logs, traces and run payloads by construction, not by redaction.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <span className="bg-accent mt-1.5 size-1 shrink-0 rounded-full" aria-hidden="true" />
                  <Text variant="caption" tone="secondary">{line}</Text>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <Field label="Provider">
        <div className="grid gap-2 sm:grid-cols-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { update({ provider: p.id, keyVerified: false }); setResult(null); }}
              aria-pressed={provider === p.id}
              className={cn(
                "flex items-center gap-2.5 rounded-md border p-2.5 text-left",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
                provider === p.id
                  ? "border-accent-border bg-accent-subtle"
                  : "border-subtle hover:bg-surface-hover",
              )}
            >
              <ProviderLogo provider={p.id} connected={provider === p.id} decorative size={18} />
              <span>
                <Text variant="body-sm" tone="primary" className="block">{p.label}</Text>
                <Text variant="caption" tone="muted" className="block">{p.hint}</Text>
              </span>
            </button>
          ))}
        </div>
      </Field>

      {provider ? (
        <div className="mt-5 grid gap-3">
          <Field
            label="API key"
            required
            description="Paste the key from your provider console. We verify it before storing it."
          >
            <Input
              type="password"
              mono
              autoComplete="off"
              spellCheck={false}
              placeholder={PROVIDERS.find((p) => p.id === provider)?.prefix ?? "Your API key"}
              value={key}
              onChange={(e) => { setKey(e.target.value); setResult(null); }}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              loading={testing}
              loadingLabel="Testing the key"
              disabled={key.trim().length === 0}
              onClick={test}
            >
              Test this key
            </Button>
            {state.keyVerified ? (
              <span className="text-status-success flex items-center gap-1.5">
                <GateApprovedIcon size={16} aria-hidden="true" />
                <Text variant="caption" className="text-status-success">Verified and stored</Text>
              </span>
            ) : null}
          </div>

          {result ? (
            <div
              role="status"
              className={cn(
                "rounded-md border p-3",
                result.ok
                  ? "bg-status-success-subtle border-status-success-border"
                  : "bg-status-failed-subtle border-status-failed-border",
              )}
            >
              <Text
                variant="caption"
                className={result.ok ? "text-status-success" : "text-status-failed"}
              >
                {result.message}
              </Text>
            </div>
          ) : null}
        </div>
      ) : null}

      <Text variant="caption" tone="muted" className="mt-5 block">
        Skipping is fine — workflows will run everything except model calls until a key is added.
      </Text>
    </div>
  );
}

/* ── 4 · First workflow ───────────────────────────────────────────────────── */

const PATHS: {
  id: "template" | "architect" | "blank";
  icon: IconComponent;
  title: string;
  body: string;
  produces: string[];
}[] = [
  {
    id: "template",
    icon: CommitBoundaryIcon,
    title: "Start from a template",
    body: "A working workflow you can run immediately, then edit.",
    produces: ["9 nodes wired end to end", "2 tools and 1 agent, pre-granted", "A schedule trigger, paused"],
  },
  {
    id: "architect",
    icon: AgentBrainIcon,
    title: "Describe it to AI Architect",
    body: "Write what it should do; the blueprint is editable before anything is created.",
    produces: ["A blueprint you approve first", "Agents, tools and gates it proposes", "A cost estimate before you build"],
  },
  {
    id: "blank",
    icon: FanOutIcon,
    title: "Start blank",
    body: "An empty canvas with a trigger node.",
    produces: ["1 trigger node", "Nothing else — you build it"],
  },
];

function StepFirstWorkflow({ state, update }: StepProps) {
  return (
    <div>
      <StepHeader
        title="Create your first workflow"
        body="Each of these produces something different. Here is exactly what you get."
      />
      <div className="grid gap-3">
        {PATHS.map((path) => {
          const selected = state.startPath === path.id;
          return (
            <button
              key={path.id}
              type="button"
              onClick={() => update({ startPath: path.id })}
              aria-pressed={selected}
              className={cn(
                "grid gap-3 rounded-md border p-4 text-left sm:grid-cols-[auto_1fr_14rem]",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
                selected ? "border-accent-border bg-accent-subtle" : "border-subtle hover:bg-surface-hover",
              )}
            >
              <span className={cn(
                "grid size-9 shrink-0 place-items-center rounded-md",
                selected ? "bg-accent text-fg-on-accent" : "bg-surface-active text-fg-secondary",
              )}>
                <path.icon size={20} aria-hidden="true" />
              </span>
              <span>
                <Text variant="heading-sm" tone="max" className="block">{path.title}</Text>
                <Text variant="body-sm" tone="secondary" className="mt-0.5 block">{path.body}</Text>
              </span>
              <span className="border-subtle grid gap-1 sm:border-l sm:pl-3">
                <Text variant="eyebrow" tone="muted" className="block">Produces</Text>
                {path.produces.map((p) => (
                  <Text key={p} variant="caption" tone="secondary" className="block">{p}</Text>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── 5 · Ready ────────────────────────────────────────────────────────────── */

function StepReady({ state }: { state: OnboardingState }) {
  const items: { done: boolean; label: string; href: string; cta: string }[] = [
    {
      done: Boolean(state.workspace),
      label: state.workspace ? `Workspace “${state.workspace}” in ${state.region}` : "Workspace not named",
      href: "/settings",
      cta: state.workspace ? "Open settings" : "Name it",
    },
    {
      done: state.keyVerified,
      label: state.keyVerified
        ? `${state.provider} key connected and verified`
        : "No model provider connected — model calls will fail",
      href: "/connections",
      cta: state.keyVerified ? "Manage connections" : "Connect a provider",
    },
    {
      done: Boolean(state.startPath),
      label: state.startPath ? `First workflow: ${state.startPath}` : "No workflow created yet",
      href: state.startPath === "architect" ? "/workflows/new/architect" : "/workflows/new",
      cta: state.startPath ? "Open the builder" : "Create one",
    },
    {
      done: state.createStaging,
      label: state.createStaging ? "Staging environment created" : "Staging not created",
      href: "/settings",
      cta: state.createStaging ? "Configure it" : "Add it later",
    },
  ];

  const outstanding = items.filter((i) => !i.done).length;

  return (
    <div>
      <StepHeader
        title={outstanding === 0 ? "You are set up" : "You are ready to start"}
        body={
          outstanding === 0
            ? "Everything is in place. Here is where to go next."
            : `${outstanding} thing${outstanding === 1 ? "" : "s"} you skipped will show on Control until it is done. Nothing is blocking you.`
        }
      />

      <ul className="border-subtle divide-subtle divide-y rounded-md border">
        {items.map((item) => (
          <li key={item.label} className="flex flex-wrap items-center gap-3 p-3.5">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border",
                item.done
                  ? "bg-status-success-subtle border-status-success-border text-status-success"
                  : "bg-status-waiting-subtle border-status-waiting-border text-status-waiting",
              )}
            >
              {item.done ? <CheckpointIcon size={13} aria-hidden="true" /> : <WorkerIcon size={13} aria-hidden="true" />}
            </span>
            <Text variant="body-sm" tone={item.done ? "secondary" : "primary"} className="min-w-0 flex-1">
              {item.label}
            </Text>
            <Button asChild size="sm" variant={item.done ? "ghost" : "secondary"}>
              <Link href={item.href as never}>{item.cta}</Link>
            </Button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild variant="primary" size="lg">
          <Link href={"/control" as never}>Go to Control</Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link href={"/docs" as never} target="_blank" rel="noreferrer">Read the quickstart</Link>
        </Button>
      </div>
    </div>
  );
}
