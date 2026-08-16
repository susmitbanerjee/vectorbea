"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Switch, Checkbox } from "~/components/ui/choice";
import { RelativeTime } from "~/components/app/workflows/atoms";
import { EMPTY } from "~/lib/format";
import {
  ENVIRONMENT_SETTINGS, API_KEYS, NOTIFICATION_RULES, workspaceContents,
  CURRENT_TIER, currentMember, roleHas,
  type NotificationRule,
} from "~/mocks/admin";

/* ══════════════════════════════════════════════════════════════════════════════
   SETTINGS — sectioned, not one long page.

   THE DANGER ZONE NAMES EXACT COUNTS, which is §12's own example: "Reset
   workspace? This deletes 163 runs and 11 workflows. Audit logs are kept."
   A confirmation that says "are you sure" transfers the decision to the user
   without giving them anything to decide with.
══════════════════════════════════════════════════════════════════════════════ */

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "environments", label: "Environments" },
  { id: "security", label: "Security" },
  { id: "billing", label: "Billing" },
  { id: "notifications", label: "Notifications" },
  { id: "danger", label: "Danger zone" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const section = (params.get("section") ?? "general") as SectionId;
  const me = currentMember();

  const setSection = (id: SectionId) => {
    const next = new URLSearchParams(params.toString());
    if (id === "general") next.delete("section");
    else next.set("section", id);
    router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Settings"
        description="Workspace configuration, environments, security and the things you cannot undo."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <nav aria-label="Settings sections">
          <ul className="grid gap-px">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => setSection(s.id)}
                  aria-current={section === s.id ? "page" : undefined}
                  className={cn(
                    "font-ui text-body-sm w-full rounded-sm px-2.5 py-1.5 text-left",
                    "transition-colors duration-fast outline-none focus-visible:focus-ring",
                    section === s.id
                      ? "bg-surface-active text-fg-primary"
                      : s.id === "danger"
                        ? "text-status-failed hover:bg-surface-hover"
                        : "text-fg-secondary hover:bg-surface-hover hover:text-fg-primary",
                  )}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-3">
          {section === "general" ? <General /> : null}
          {section === "environments" ? <Environments /> : null}
          {section === "security" ? <Security /> : null}
          {section === "billing" ? <Billing /> : null}
          {section === "notifications" ? <Notifications /> : null}
          {section === "danger" ? <DangerZone canDelete={roleHas(me.role, "workspace-delete")} /> : null}
        </div>
      </div>
    </PageContainer>
  );
}

/* ── General ──────────────────────────────────────────────────────────────── */

function General() {
  return (
    <Card title="Workspace" help="How this workspace is identified and what it defaults to.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" help="Shown in the switcher and on invitations.">
          <Input defaultValue="Acme Platform" className="h-8 text-body-sm" />
        </Field>
        <Field label="Slug" help="Used in URLs and the CLI. Changing it breaks existing links.">
          <Input defaultValue="acme-platform" className="h-8 font-code text-mono-sm" />
        </Field>
        <Field label="Region" help="Where runs execute and data rests. Cannot be changed after creation.">
          <Select
            options={[{ value: "eu-west", label: "EU West (Ireland)" }]}
            value="eu-west"
            onValueChange={() => {}}
            disabled
            aria-label="Region"
          />
        </Field>
        <Field label="Default timezone" help="Used wherever a schedule does not set its own.">
          <Select
            options={[
              { value: "UTC", label: "UTC" },
              { value: "Europe/London", label: "Europe/London" },
              { value: "America/New_York", label: "America/New_York" },
            ]}
            value="UTC"
            onValueChange={() => {}}
            aria-label="Default timezone"
          />
        </Field>
        <Field label="Default environment" help="Which environment the console opens in.">
          <Select
            options={[
              { value: "production", label: "Production" },
              { value: "staging", label: "Staging" },
              { value: "development", label: "Development" },
            ]}
            value="production"
            onValueChange={() => {}}
            aria-label="Default environment"
          />
        </Field>
      </div>
    </Card>
  );
}

/* ── Environments ─────────────────────────────────────────────────────────── */

function Environments() {
  return (
    <>
      <Card title="Environments" help="Each is a separate set of connections and policies. A workflow exists in one at a time and is promoted between them.">
        <ul className="grid gap-3">
          {ENVIRONMENT_SETTINGS.map((env) => (
            <li key={env.id} className="border-subtle rounded-md border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Text variant="body-sm" tone="primary" className="font-medium">{env.label}</Text>
                <Text variant="caption" tone="muted">{env.defaultConnections.length} default connections</Text>
              </div>

              <div className="mt-2 grid gap-2">
                <div>
                  <Text variant="caption" tone="secondary" className="block">Default connections</Text>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {env.defaultConnections.map((name) => (
                      <li key={name} className="border-subtle text-fg-secondary font-ui text-caption rounded-xs border px-1.5 py-0.5">
                        {name}
                      </li>
                    ))}
                  </ul>
                  <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
                    Bound automatically when a workflow is promoted here, unless the node names one
                    explicitly.
                  </Text>
                </div>

                <div>
                  <Text variant="caption" tone="secondary" className="block">Approval policy</Text>
                  <Text variant="body-sm" tone="primary" className="block">{env.approvalPolicy}</Text>
                </div>

                <div>
                  <Text variant="caption" tone="secondary" className="block">Promotion rules</Text>
                  <ul className="mt-1 grid gap-0.5">
                    {env.promotionRules.map((rule) => (
                      <li key={rule} className="flex gap-1.5">
                        <span className="text-fg-disabled" aria-hidden="true">·</span>
                        <Text variant="caption" tone="secondary" className="leading-snug">{rule}</Text>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/* ── Security ─────────────────────────────────────────────────────────────── */

function Security() {
  const [sso, setSso] = React.useState(false);
  const [allowlist, setAllowlist] = React.useState(false);

  return (
    <>
      <Card title="Single sign-on" help="Delegate authentication to your identity provider." tone={sso ? undefined : "muted"}>
        <label className="flex items-start gap-2">
          <Switch checked={sso} onCheckedChange={setSso} />
          <span className="min-w-0">
            <Text variant="body-sm" tone="primary" className="block">SAML 2.0</Text>
            <Text variant="caption" tone="muted" className="block leading-snug">
              Available on Business and above. With SSO on, password sign-in is disabled for everyone
              except break-glass Owners.
            </Text>
          </span>
        </label>
        {sso ? (
          <div className="mt-3 grid gap-2">
            <Field label="Metadata URL" help="From your identity provider.">
              <Input placeholder="https://idp.example/metadata.xml" className="h-8 font-code text-mono-sm" />
            </Field>
            <Field label="ACS URL" help="Give this to your provider. Read-only.">
              <Input readOnly defaultValue="https://api.vectorbea.com/saml/acs/acme-platform" className="h-8 font-code text-mono-sm" />
            </Field>
          </div>
        ) : null}
      </Card>

      <Card title="Allowed email domains" help="Only addresses at these domains may be invited or may sign in.">
        <div className="flex flex-wrap gap-1.5">
          {["acme.example"].map((domain) => (
            <span key={domain} className="border-subtle text-fg-secondary font-code text-mono-sm rounded-xs border px-1.5 py-0.5">
              {domain}
            </span>
          ))}
        </div>
        <Text variant="caption" tone="muted" className="mt-1.5 block leading-snug">
          A sign-in from outside these domains is refused and recorded in the audit log — that is the
          `denied` line you will see there from partner.example.
        </Text>
      </Card>

      <Card title="Sessions" help="How long a signed-in session stays valid.">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Session length" help="Hours before re-authentication is required.">
            <Input type="number" defaultValue={168} className="h-8 text-body-sm" />
          </Field>
          <Field label="Idle timeout" help="Hours of inactivity before a session ends.">
            <Input type="number" defaultValue={24} className="h-8 text-body-sm" />
          </Field>
        </div>
      </Card>

      <Card title="IP allowlist" help="Restrict console and API access by source address.">
        <label className="flex items-start gap-2">
          <Switch checked={allowlist} onCheckedChange={setAllowlist} />
          <span className="min-w-0">
            <Text variant="body-sm" tone="primary" className="block">Restrict by address</Text>
            <Text variant="caption" tone="muted" className="block leading-snug">
              Available on Business and above. Lock yourself out and only a support request restores
              access, so add your current address before enabling.
            </Text>
          </span>
        </label>
      </Card>

      <Card title="API keys" help="Programmatic access. A key carries the scopes it was created with, not the creator's role.">
        <ul className="grid gap-2">
          {API_KEYS.map((key) => {
            const stale = key.lastUsedAt === null;
            return (
              <li
                key={key.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-md border p-2.5",
                  stale ? "border-status-waiting-border bg-status-waiting-subtle" : "border-subtle",
                )}
              >
                <span className="min-w-0 flex-1">
                  <Text variant="body-sm" tone="primary" className="block truncate">{key.name}</Text>
                  <Text variant="caption" tone="muted" className="block font-code">
                    ••••{key.last4} · {key.scopes.join(", ")}
                  </Text>
                </span>
                <Text variant="caption" tone={stale ? "inherit" : "muted"} className={stale ? "text-status-waiting" : undefined}>
                  {key.lastUsedAt ? <>used <RelativeTime iso={key.lastUsedAt} /></> : "never used"}
                </Text>
                <Button size="xs" variant="ghost" className="text-status-failed">Revoke</Button>
              </li>
            );
          })}
        </ul>
        <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
          A key that has never been used is a credential nobody would miss — and one nobody would
          notice being used. Revoke it.
        </Text>
        <div className="mt-2"><Button size="sm" variant="secondary">Create a key</Button></div>
      </Card>

      <Card title="Secret rotation" help="How often connections must be rotated before they are flagged.">
        <Field label="Rotation reminder" help="Days. Connections older than this are flagged on the Connections page.">
          <Input type="number" defaultValue={90} className="h-8 text-body-sm" />
        </Field>
      </Card>
    </>
  );
}

/* ── Billing ──────────────────────────────────────────────────────────────── */

function Billing() {
  return (
    <>
      <Card title="Plan" help="What you are on, and what it costs.">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Text variant="heading-sm" tone="max" className="block">{CURRENT_TIER}</Text>
            <Text variant="caption" tone="muted" className="block">No card on file.</Text>
          </div>
          <Button asChild variant="primary" size="sm">
            <Link href={"/usage" as Route}>See limits and upgrade</Link>
          </Button>
        </div>
      </Card>

      <Card title="Budget" help="A reporting threshold rather than a hard cap — work does not stop when it is crossed.">
        <Field label="Monthly budget" help="USD. Crossing it raises an alert on Control, and per-step cost ceilings still apply.">
          <Input type="number" defaultValue={360} className="h-8 text-body-sm" />
        </Field>
      </Card>
    </>
  );
}

/* ── Notifications ────────────────────────────────────────────────────────── */

function Notifications() {
  const [rules, setRules] = React.useState<NotificationRule[]>(NOTIFICATION_RULES);

  const toggle = (id: string, channel: NotificationRule["channels"][number]) => {
    setRules((current) => current.map((rule) => rule.id === id
      ? {
        ...rule,
        channels: rule.channels.includes(channel)
          ? rule.channels.filter((c) => c !== channel)
          : [...rule.channels, channel],
      }
      : rule));
  };

  return (
    <Card
      title="Routing rules"
      help="Which events reach which channel, and at what severity. The bell in the topbar had nothing behind it before this."
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem]">
          <caption className="sr-only">Notification routing</caption>
          <thead>
            <tr className="border-subtle text-fg-muted font-ui text-eyebrow border-b uppercase">
              <th scope="col" className="py-2 pr-3 text-left font-normal">Event</th>
              <th scope="col" className="px-2 py-2 text-left font-normal">Severity</th>
              <th scope="col" className="px-2 py-2 text-center font-normal">Email</th>
              <th scope="col" className="px-2 py-2 text-center font-normal">Slack</th>
              <th scope="col" className="px-2 py-2 text-center font-normal">Webhook</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-subtle border-b last:border-b-0">
                <th scope="row" className="py-2 pr-3 text-left font-normal">
                  <Text variant="body-sm" tone="primary" className="block">{rule.event}</Text>
                  <Text variant="caption" tone="muted" className="block leading-snug">{rule.help}</Text>
                </th>
                <td className="px-2 py-2">
                  <Select
                    options={[
                      { value: "all", label: "All" },
                      { value: "high", label: "High and above" },
                      { value: "critical", label: "Critical only" },
                    ]}
                    value={rule.severity}
                    onValueChange={() => {}}
                    aria-label={`Severity for ${rule.event}`}
                  />
                </td>
                {(["email", "slack", "webhook"] as const).map((channel) => (
                  <td key={channel} className="px-2 py-2 text-center">
                    <Checkbox
                      checked={rule.channels.includes(channel)}
                      onCheckedChange={() => toggle(rule.id, channel)}
                      aria-label={`${channel} for ${rule.event}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Text variant="caption" tone="muted" className="mt-2 block leading-snug">
        An event with no channel is still recorded and still shows in the inbox — routing decides
        what interrupts somebody, not what is captured.
      </Text>
    </Card>
  );
}

/* ── Danger zone ──────────────────────────────────────────────────────────── */

function DangerZone({ canDelete }: { canDelete: boolean }) {
  const [action, setAction] = React.useState<null | "reset" | "delete">(null);
  const contents = workspaceContents();

  return (
    <>
      <Card title="Reset workspace" tone="danger" help="Removes the work, keeps the workspace and its members.">
        <Text variant="body-sm" tone="secondary" className="block">
          Deletes {contents.runs} runs and {contents.workflows} workflows, along with{" "}
          {contents.agents} agents. Connections, members and audit logs are kept.
        </Text>
        <div className="mt-2">
          <Button variant="danger" size="sm" onClick={() => setAction("reset")}>Reset workspace</Button>
        </div>
      </Card>

      <Card title="Transfer ownership" tone="danger" help="Makes another member the Owner. You become an Admin.">
        <Text variant="body-sm" tone="secondary" className="block">
          There is exactly one Owner. Transferring hands over billing and the ability to delete the
          workspace — it cannot be undone without the new Owner transferring back.
        </Text>
        <div className="mt-2">
          <Button variant="secondary" size="sm" disabled={!canDelete}>Transfer ownership</Button>
        </div>
      </Card>

      <Card title="Delete workspace" tone="danger" help="Everything, permanently.">
        <Text variant="body-sm" tone="secondary" className="block">
          Deletes {contents.runs} runs, {contents.workflows} workflows, {contents.connections}{" "}
          connections and removes {contents.members} members. Audit logs are retained for the
          statutory period and then destroyed.
        </Text>
        <div className="mt-2">
          <Button variant="danger" size="sm" disabled={!canDelete} onClick={() => setAction("delete")}>
            Delete workspace
          </Button>
        </div>
        {!canDelete ? (
          <Text variant="caption" tone="muted" className="mt-1 block">
            Only the Owner can delete a workspace.
          </Text>
        ) : null}
      </Card>

      <ConfirmDialog action={action} contents={contents} onClose={() => setAction(null)} />
    </>
  );
}

function ConfirmDialog({
  action, contents, onClose,
}: {
  action: null | "reset" | "delete";
  contents: ReturnType<typeof workspaceContents>;
  onClose: () => void;
}) {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => { setTyped(""); }, [action]);

  if (!action) return null;
  const phrase = action === "reset" ? "reset acme-platform" : "delete acme-platform";
  const confirmed = typed.trim() === phrase;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "motion-overlay z-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "bg-surface-overlay border-subtle shadow-3 w-[min(32rem,calc(100vw-2rem))] rounded-lg border p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">
              {action === "reset" ? "Reset workspace?" : "Delete workspace?"}
            </Text>
          </Dialog.Title>

          {/* §12's own example, made literal. */}
          <div className="border-status-failed-border bg-status-failed-subtle mt-3 rounded-md border p-3">
            <Text variant="body-sm" tone="inherit" className="text-status-failed block">
              {action === "reset"
                ? `This deletes ${contents.runs} runs and ${contents.workflows} workflows. Audit logs are kept.`
                : `This deletes ${contents.runs} runs, ${contents.workflows} workflows and ${contents.connections} connections, and removes ${contents.members} members.`}
            </Text>
            <Text variant="caption" tone="secondary" className="mt-1 block leading-snug">
              {action === "reset"
                ? "Connections and members survive, so the workspace is usable immediately afterwards. Nothing that has already run can be recovered."
                : "Audit logs are retained for the statutory period and then destroyed. Nothing else survives."}
            </Text>
          </div>

          <label className="mt-3 grid gap-1">
            <Text variant="caption" tone="secondary">Type “{phrase}” to confirm</Text>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={phrase}
              className="h-8 font-code text-mono-sm"
            />
          </label>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">Keep it</Button>
            </Dialog.Close>
            <Button variant="danger" size="sm" disabled={!confirmed}>
              {action === "reset" ? `Reset and delete ${contents.runs} runs` : "Delete permanently"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Chrome ───────────────────────────────────────────────────────────────── */

function Card({
  title, help, children, tone,
}: {
  title: string;
  help?: string;
  children: React.ReactNode;
  tone?: "danger" | "muted";
}) {
  return (
    <section
      className={cn(
        "rounded-lg border p-3",
        tone === "danger" ? "border-status-failed-border bg-status-failed-subtle" : "border-subtle bg-surface-raised",
      )}
    >
      <Text
        variant="label"
        tone="inherit"
        className={cn("block", tone === "danger" ? "text-status-failed" : "text-fg-primary")}
      >
        {title}
      </Text>
      {help ? <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">{help}</Text> : <div className="mb-2" />}
      {children}
    </section>
  );
}

function Field({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1">
      <Text variant="caption" tone="secondary">{label}</Text>
      {children}
      <Text variant="caption" tone="muted" className="leading-snug">{help}</Text>
    </label>
  );
}

export { EMPTY };
