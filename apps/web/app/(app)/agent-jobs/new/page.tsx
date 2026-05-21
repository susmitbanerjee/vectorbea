"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cronToHumanText, validateCron } from "@/lib/cron-humanizer";

// ─── Common timezones ────────────────────────────────────────────────────────

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormValues {
  name: string;
  description: string;
  triggerType: "MANUAL" | "CRON";
  cronExpression: string;
  timezone: string;
  endpointUrl: string;
  httpMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  maxDurationSeconds: string;
  maxRetries: string;
  retryBackoffSeconds: string;
  requireApprovalBeforeRun: boolean;
  requireApprovalBeforeExternalAction: boolean;
  hasBudget: boolean;
  maxTokensPerRun: string;
  maxCostUsdPerRun: string;
  maxRunsPerDay: string;
  maxRunsPerMonth: string;
}

function emptyForm(): FormValues {
  return {
    name: "",
    description: "",
    triggerType: "MANUAL",
    cronExpression: "",
    timezone: "UTC",
    endpointUrl: "",
    httpMethod: "POST",
    maxDurationSeconds: "300",
    maxRetries: "3",
    retryBackoffSeconds: "60",
    requireApprovalBeforeRun: false,
    requireApprovalBeforeExternalAction: false,
    hasBudget: false,
    maxTokensPerRun: "",
    maxCostUsdPerRun: "",
    maxRunsPerDay: "",
    maxRunsPerMonth: "",
  };
}

// ─── Field helpers ────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function selectCls() {
  return "h-9 w-full rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20";
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <div className="mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          onClick={() => onChange(!checked)}
          className={`h-5 w-9 rounded-full transition-colors cursor-pointer ${checked ? "bg-primary" : "bg-border"} relative`}
        >
          <div
            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`}
          />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </label>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CreateAgentJobPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormValues>(emptyForm());
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormValues, string>> = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    if (form.triggerType === "CRON") {
      if (!form.cronExpression.trim()) {
        errs.cronExpression = "Cron expression is required for scheduled jobs.";
      } else {
        const cronErr = validateCron(form.cronExpression);
        if (cronErr) errs.cronExpression = cronErr;
      }
    }
    if (!form.endpointUrl.trim()) {
      errs.endpointUrl = "Endpoint URL is required.";
    } else {
      try {
        new URL(form.endpointUrl);
      } catch {
        errs.endpointUrl = "Must be a valid URL (e.g. https://example.com/agent).";
      }
    }
    const dur = parseInt(form.maxDurationSeconds, 10);
    if (isNaN(dur) || dur < 1 || dur > 86400)
      errs.maxDurationSeconds = "Must be between 1 and 86,400 seconds.";
    const retries = parseInt(form.maxRetries, 10);
    if (isNaN(retries) || retries < 0 || retries > 10)
      errs.maxRetries = "Must be between 0 and 10.";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      triggerType: form.triggerType,
      timezone: form.timezone,
      endpointUrl: form.endpointUrl.trim(),
      httpMethod: form.httpMethod,
      maxDurationSeconds: parseInt(form.maxDurationSeconds, 10),
      maxRetries: parseInt(form.maxRetries, 10),
      retryBackoffSeconds: parseInt(form.retryBackoffSeconds, 10),
      requireApprovalBeforeRun: form.requireApprovalBeforeRun,
      requireApprovalBeforeExternalAction: form.requireApprovalBeforeExternalAction,
    };

    if (form.triggerType === "CRON") body.cronExpression = form.cronExpression.trim();

    if (form.hasBudget) {
      body.budgetPolicy = {
        maxTokensPerRun: form.maxTokensPerRun ? parseInt(form.maxTokensPerRun, 10) : null,
        maxCostUsdPerRun: form.maxCostUsdPerRun ? parseFloat(form.maxCostUsdPerRun) : null,
        maxRunsPerDay: form.maxRunsPerDay ? parseInt(form.maxRunsPerDay, 10) : null,
        maxRunsPerMonth: form.maxRunsPerMonth ? parseInt(form.maxRunsPerMonth, 10) : null,
      };
    }

    try {
      const res = await fetch("/api/agent-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string; errors?: Record<string, string> };
        if (data.errors) {
          const mapped: Partial<Record<keyof FormValues, string>> = {};
          for (const [k, v] of Object.entries(data.errors)) {
            mapped[k as keyof FormValues] = v;
          }
          setErrors(mapped);
        } else {
          toast.error(data.error ?? "Failed to create job.");
        }
        return;
      }

      const created = (await res.json()) as { job: { id: string } };
      toast.success("Agent job created.");
      router.push(`/agent-jobs/${created.job.id}`);
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const cronPreview =
    form.triggerType === "CRON" && form.cronExpression
      ? cronToHumanText(form.cronExpression, form.timezone)
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-8">
      {/* Header */}
      <div>
        <Link
          href="/agent-jobs"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to jobs
        </Link>
        <h1 className="text-xl font-semibold">Create Agent Job</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Configure a new scheduled AI agent job.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {/* Basic info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Name" required error={errors.name}>
              <Input
                placeholder="e.g. Daily support ticket triage"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
            <Field label="Description" hint="Optional. Shown in the job list and detail view.">
              <textarea
                placeholder="What does this job do?"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </Field>
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Choose how this job is triggered.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Trigger type" required>
              <select
                value={form.triggerType}
                onChange={(e) => set("triggerType", e.target.value as "MANUAL" | "CRON")}
                className={selectCls()}
              >
                <option value="MANUAL">Manual — triggered via API or dashboard</option>
                <option value="CRON">Scheduled — runs on a cron expression</option>
              </select>
            </Field>

            {form.triggerType === "CRON" && (
              <>
                <Field
                  label="Cron expression"
                  required
                  error={errors.cronExpression}
                  hint={cronPreview ?? "Standard 5-field cron: minute hour day month weekday"}
                >
                  <Input
                    placeholder="0 9 * * *"
                    value={form.cronExpression}
                    onChange={(e) => set("cronExpression", e.target.value)}
                    className="font-mono"
                  />
                </Field>
                <Field label="Timezone">
                  <select
                    value={form.timezone}
                    onChange={(e) => set("timezone", e.target.value)}
                    className={selectCls()}
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
          </CardContent>
        </Card>

        {/* Endpoint */}
        <Card>
          <CardHeader>
            <CardTitle>Endpoint</CardTitle>
            <CardDescription>
              This endpoint will be called whenever the job runs. It should accept a POST body with{" "}
              <code className="rounded bg-muted px-1 text-xs">agentRunId</code> and return a JSON
              response.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Endpoint URL" required error={errors.endpointUrl}>
              <Input
                type="url"
                placeholder="https://your-agent.example.com/run"
                value={form.endpointUrl}
                onChange={(e) => set("endpointUrl", e.target.value)}
              />
            </Field>
            <Field label="HTTP method">
              <select
                value={form.httpMethod}
                onChange={(e) =>
                  set("httpMethod", e.target.value as "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
                }
                className={selectCls()}
              >
                {["POST", "GET", "PUT", "PATCH", "DELETE"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </CardContent>
        </Card>

        {/* Execution */}
        <Card>
          <CardHeader>
            <CardTitle>Execution Policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Field
                label="Max duration (seconds)"
                error={errors.maxDurationSeconds}
                hint="1 – 86,400"
              >
                <Input
                  type="number"
                  min={1}
                  max={86400}
                  value={form.maxDurationSeconds}
                  onChange={(e) => set("maxDurationSeconds", e.target.value)}
                />
              </Field>
              <Field label="Max retries" error={errors.maxRetries} hint="0 – 10">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={form.maxRetries}
                  onChange={(e) => set("maxRetries", e.target.value)}
                />
              </Field>
              <Field label="Retry backoff (seconds)" hint="Delay between retries">
                <Input
                  type="number"
                  min={1}
                  max={3600}
                  value={form.retryBackoffSeconds}
                  onChange={(e) => set("retryBackoffSeconds", e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* Approval gates */}
        <Card>
          <CardHeader>
            <CardTitle>Approval Gates</CardTitle>
            <CardDescription>
              Use approval gates before actions like sending emails, updating a CRM, or writing to
              databases. The run pauses and waits for a human to approve before continuing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Toggle
              checked={form.requireApprovalBeforeRun}
              onChange={(v) => set("requireApprovalBeforeRun", v)}
              label="Require approval before each run"
              description="A human must approve before the job executes."
            />
            <Toggle
              checked={form.requireApprovalBeforeExternalAction}
              onChange={(v) => set("requireApprovalBeforeExternalAction", v)}
              label="Require approval before external actions"
              description="The agent must request approval before making any external API calls."
            />
          </CardContent>
        </Card>

        {/* Budget */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Budget Policy</CardTitle>
              <CardDescription>Optional limits on cost and run frequency.</CardDescription>
            </div>
            <Toggle
              checked={form.hasBudget}
              onChange={(v) => set("hasBudget", v)}
              label=""
            />
          </CardHeader>
          {form.hasBudget && (
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Max tokens per run" hint="Leave blank for no limit">
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 100000"
                    value={form.maxTokensPerRun}
                    onChange={(e) => set("maxTokensPerRun", e.target.value)}
                  />
                </Field>
                <Field label="Max cost per run (USD)" hint="Leave blank for no limit">
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="e.g. 5.00"
                    value={form.maxCostUsdPerRun}
                    onChange={(e) => set("maxCostUsdPerRun", e.target.value)}
                  />
                </Field>
                <Field label="Max runs per day" hint="Leave blank for no limit">
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 10"
                    value={form.maxRunsPerDay}
                    onChange={(e) => set("maxRunsPerDay", e.target.value)}
                  />
                </Field>
                <Field label="Max runs per month" hint="Leave blank for no limit">
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 300"
                    value={form.maxRunsPerMonth}
                    onChange={(e) => set("maxRunsPerMonth", e.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Info callout */}
        <div className="flex gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-blue-700 dark:text-blue-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your endpoint should return{" "}
            <code className="rounded bg-blue-500/10 px-1">{"{ status: \"succeeded\" | \"requires_approval\" | \"failed\" }"}</code>
            . See the docs for the full response schema.
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Link
            href="/agent-jobs"
            className="inline-flex h-9 items-center rounded-lg border border-border bg-transparent px-4 py-2 text-sm font-medium hover:bg-muted/60"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create job"}
          </Button>
        </div>
      </form>
    </div>
  );
}
