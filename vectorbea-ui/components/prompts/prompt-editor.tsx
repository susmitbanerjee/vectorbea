"use client";

import { useEffect, useMemo, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  Copy,
  Eye,
  FileCode2,
  FlaskConical,
  GitBranch,
  History,
  Loader2,
  Lock,
  Save,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { type PromptDetail } from "@/lib/api";
import type { PromptReleasePolicy, PromptRolloutDistribution, RolloutStatus } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRBAC, useWorkspace } from "@/lib/workspace-context";

function renderPreview(
  template: string,
  parameters: Record<string, unknown> | null,
): string {
  if (!parameters) return template;
  let result = template;
  for (const [key, value] of Object.entries(parameters)) {
    const placeholder = `{{${key}}}`;
    if (result.includes(placeholder)) {
      result = result.replaceAll(placeholder, String(value));
    }
  }
  return result;
}

function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(2, -2).trim()))];
}

function relativeTime(value: string | null): string {
  if (!value) return "Unknown";
  const now = Date.now();
  const then = new Date(value).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type ModelParametersForm = {
  model: string;
  temperature: string;
  maxTokens: string;
  topP: string;
  seed: string;
  ragSources: string;
  stopSequences: string;
};

function toFormParameters(parameters: Record<string, unknown>): ModelParametersForm {
  const rag = parameters.rag_sources;
  const stop = parameters.stop_sequences;
  return {
    model: String(parameters.model ?? ""),
    temperature: String(parameters.temperature ?? ""),
    maxTokens: String(parameters.max_tokens ?? ""),
    topP: String(parameters.top_p ?? ""),
    seed: String(parameters.seed ?? ""),
    ragSources: Array.isArray(rag) ? rag.map(String).join(", ") : "",
    stopSequences: Array.isArray(stop) ? stop.map(String).join(", ") : "",
  };
}

function toPersistedParameters(form: ModelParametersForm): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const toNumber = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  if (form.model.trim()) next.model = form.model.trim();
  if (form.temperature.trim()) {
    const parsed = toNumber(form.temperature.trim());
    if (parsed !== null) next.temperature = parsed;
  }
  if (form.maxTokens.trim()) {
    const parsed = toNumber(form.maxTokens.trim());
    if (parsed !== null) next.max_tokens = Math.round(parsed);
  }
  if (form.topP.trim()) {
    const parsed = toNumber(form.topP.trim());
    if (parsed !== null) next.top_p = parsed;
  }
  if (form.seed.trim()) {
    const parsed = toNumber(form.seed.trim());
    if (parsed !== null) next.seed = Math.round(parsed);
  }

  const ragSources = form.ragSources
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (ragSources.length > 0) next.rag_sources = ragSources;

  const stopSequences = form.stopSequences
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (stopSequences.length > 0) next.stop_sequences = stopSequences;

  return next;
}

async function getApiErrorMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

function summarizeVersionState(
  current: PromptDetail,
  latestPublished: PromptDetail | null,
) {
  if (!latestPublished) {
    return "Draft only. Publish this prompt before developers can import it.";
  }
  if (current.promptVersionId === latestPublished.promptVersionId) {
    return `Published ${latestPublished.versionTag} is live for import.`;
  }
  return `Published ${latestPublished.versionTag} remains live while ${current.versionTag} is your editable draft.`;
}

function LineNumbers({ text }: { text: string }) {
  const lines = text.split("\n").length;
  return (
    <div
      aria-hidden
      className="select-none pr-4 text-right font-mono text-xs leading-7 text-muted-foreground/70"
    >
      {Array.from({ length: lines }, (_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  );
}

export function PromptEditor({
  prompt,
  versions: initialVersions,
}: {
  prompt: PromptDetail;
  versions: PromptDetail[];
}) {
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspace();
  const { hasAccess: canEdit } = useRBAC("editor");
  const [currentPrompt, setCurrentPrompt] = useState(prompt);
  const [versions, setVersions] = useState(initialVersions);
  const [selectedVersionId, setSelectedVersionId] = useState(
    prompt.promptVersionId,
  );
  const [templateText, setTemplateText] = useState(prompt.templateText);
  const [modelParameters, setModelParameters] = useState<ModelParametersForm>(
    toFormParameters(prompt.parameters),
  );
  const [isPending, startTransition] = useTransition();
  const [isPublishPending, startPublishTransition] = useTransition();
  const [rolloutDist, setRolloutDist] = useState<PromptRolloutDistribution | null>(null);
  const [rolloutSaving, setRolloutSaving] = useState(false);
  // Set of promptVersionIds that have a ready_for_rollout evaluation verdict
  const [readyVersionIds, setReadyVersionIds] = useState<Set<string>>(new Set());

  type AutoEvalRun = {
    id: string;
    status: string;
    recommendation: string | null;
    score: number | null;
    createdAt: string | null;
    triggerReason: string | null;
  };
  const [autoEvalRun, setAutoEvalRun] = useState<AutoEvalRun | null | "loading">("loading");
  const [policy, setPolicy] = useState<PromptReleasePolicy | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [rolloutComplete, setRolloutComplete] = useState<{
    versionTag: string;
    versionId: string;
    evalRunId: string | null;
  } | null>(null);

  // Keep local state in sync when the server component re-fetches after
  // router.refresh() (e.g., right after a save or publish completes).
  useEffect(() => {
    setCurrentPrompt(prompt);
  }, [prompt]);
  useEffect(() => {
    setVersions(initialVersions);
  }, [initialVersions]);

  const selectedVersion = useMemo(
    () =>
      versions.find((v) => v.promptVersionId === selectedVersionId) ??
      currentPrompt,
    [currentPrompt, selectedVersionId, versions],
  );
  const isViewingCurrentDraft =
    selectedVersion.promptVersionId === currentPrompt.promptVersionId;
  const latestPublished = useMemo(
    () => versions.find((v) => v.isPublished) ?? null,
    [versions],
  );

  const variables = useMemo(
    () => extractVariables(templateText),
    [templateText],
  );

  useEffect(() => {
    setTemplateText(selectedVersion.templateText);
    setModelParameters(toFormParameters(selectedVersion.parameters));
  }, [selectedVersion]);

  useEffect(() => {
    let cancelled = false;
    if (!prompt?.promptId || !activeWorkspaceId) return;

    // Fetch rollout distribution, evaluation verdicts, and release policy in parallel
    Promise.all([
      fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/rollout?workspaceId=${encodeURIComponent(activeWorkspaceId)}`).then(r => r.json()),
      fetch(`/api/evaluations/trace-sets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }).then(r => r.json()).catch(() => []),
      fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/policy?workspaceId=${encodeURIComponent(activeWorkspaceId)}`).then(r => r.json()).catch(() => null),
    ]).then(([dist, runs, pol]) => {
      if (cancelled) return;
      if (dist && Array.isArray(dist.versions)) {
        setRolloutDist(dist as PromptRolloutDistribution);
      }
      // Build set of version IDs that have at least one ready_for_rollout run
      // Also find latest auto-eval run for the current prompt version
      if (Array.isArray(runs)) {
        const ready = new Set<string>();
        type EvalRun = {
          id: string;
          candidatePromptVersionId?: string;
          aggregate?: { recommendation?: string; avgScore?: number | null };
          status?: string;
          createdAt?: string | null;
          triggerReason?: string | null;
        };
        const typedRuns = runs as EvalRun[];
        for (const run of typedRuns) {
          if (run.candidatePromptVersionId && run.aggregate?.recommendation === "ready_for_rollout") {
            ready.add(run.candidatePromptVersionId);
          }
        }
        setReadyVersionIds(ready);

        // Find the latest auto-eval run for the currently displayed version
        const versionRuns = typedRuns
          .filter((r) => r.candidatePromptVersionId === prompt.promptVersionId)
          .sort((a, b) => {
            const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return tb - ta;
          });
        const latest = versionRuns[0] ?? null;
        setAutoEvalRun(
          latest
            ? {
                id: latest.id,
                status: latest.status ?? "unknown",
                recommendation: latest.aggregate?.recommendation ?? null,
                score: latest.aggregate?.avgScore ?? null,
                createdAt: latest.createdAt ?? null,
                triggerReason: latest.triggerReason ?? null,
              }
            : null,
        );
      }
      if (pol && !pol.error) setPolicy(pol as PromptReleasePolicy);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [prompt?.promptId, activeWorkspaceId]);

  const parsedParameters = useMemo(
    () => toPersistedParameters(modelParameters),
    [modelParameters],
  );

  const refreshVersions = useCallback(
    (updatedPrompt: PromptDetail) => {
      setCurrentPrompt(updatedPrompt);
      setVersions((previous) => {
        const next = [
          updatedPrompt,
          ...previous.filter(
            (item) =>
              item.promptVersionId !== updatedPrompt.promptVersionId,
          ),
        ];
        return next.sort((left, right) => {
          const leftDate = left.createdAt
            ? new Date(left.createdAt).getTime()
            : 0;
          const rightDate = right.createdAt
            ? new Date(right.createdAt).getTime()
            : 0;
          return rightDate - leftDate;
        });
      });
      setSelectedVersionId(updatedPrompt.promptVersionId);
    },
    [],
  );

  const savePrompt = () => {
    const templateChanged = templateText !== currentPrompt.templateText;
    const parametersChanged =
      JSON.stringify(parsedParameters) !==
      JSON.stringify(currentPrompt.parameters);

    if (!templateChanged && !parametersChanged) {
      toast.info("No changes to save.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/prompts/${currentPrompt.promptId}${activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: currentPrompt.description,
              templateText,
              parameters: parsedParameters,
              versionTag: currentPrompt.isPublished
                ? null
                : currentPrompt.versionTag,
            }),
          },
        );
        if (!response.ok) {
          throw new Error(
            await getApiErrorMessage(response, "Failed to save prompt."),
          );
        }

        const updatedPrompt = (await response.json()) as PromptDetail;

        // Audit event: store before/after so the audit page can render a
        // precise field-level diff. Only include fields that actually changed.
        const metadata: Record<string, unknown> = {
          action: "update",
          source: "prompt-editor",
          prompt_name: updatedPrompt.name,
          version_transition: `${currentPrompt.versionTag} → ${updatedPrompt.versionTag}`,
        };
        if (templateChanged) {
          metadata.before_template = currentPrompt.templateText;
          metadata.after_template = updatedPrompt.templateText;
        }
        if (parametersChanged) {
          metadata.before_parameters = currentPrompt.parameters;
          metadata.after_parameters = updatedPrompt.parameters;
        }

        const workspaceAwareAuditResponse = await fetch(
          `/api/audit/batch${activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([
              {
                promptVersionId: updatedPrompt.promptVersionId,
                proxyLatencyMs: 0,
                llmLatencyMs: 0,
                tokenCount: 0,
                metadata,
              },
            ]),
          },
        );
        if (!workspaceAwareAuditResponse.ok) {
          throw new Error(
            await getApiErrorMessage(
              workspaceAwareAuditResponse,
              "Audit limit reached or audit logging is currently unavailable.",
            ),
          );
        }

        // Update local state first for instant feedback, then refresh the
        // server component so the server-fetched versions list re-renders
        // with the freshly-created draft row from the backend.
        refreshVersions(updatedPrompt);
        setTemplateText(updatedPrompt.templateText);
        setModelParameters(toFormParameters(updatedPrompt.parameters));
        toast.success(
          `Saved as ${updatedPrompt.versionTag}${updatedPrompt.isPublished ? "" : " (draft)"}`,
        );
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to save prompt.",
        );
      }
    });
  };

  const publishPrompt = () => {
    const previouslyPublished = latestPublished;
    startPublishTransition(async () => {
      try {
        const response = await fetch(
          `/api/prompts/${currentPrompt.promptId}/publish${activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : ""}`,
          { method: "POST" },
        );
        if (!response.ok) {
          throw new Error(
            await getApiErrorMessage(response, "Failed to publish prompt."),
          );
        }

        const publishedPrompt = (await response.json()) as PromptDetail;

        // Dedicated publish audit: only captures the version transition —
        // no template/parameter diff (publish never mutates content).
        const auditResponse = await fetch(
          `/api/audit/batch${activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([
              {
                promptVersionId: publishedPrompt.promptVersionId,
                proxyLatencyMs: 0,
                llmLatencyMs: 0,
                tokenCount: 0,
                metadata: {
                  action: "publish",
                  source: "prompt-editor",
                  prompt_name: publishedPrompt.name,
                  published_version: publishedPrompt.versionTag,
                  previous_published_version:
                    previouslyPublished &&
                    previouslyPublished.promptVersionId !==
                      publishedPrompt.promptVersionId
                      ? previouslyPublished.versionTag
                      : null,
                },
              },
            ]),
          },
        );
        if (!auditResponse.ok) {
          throw new Error(
            await getApiErrorMessage(
              auditResponse,
              "Audit limit reached or audit logging is currently unavailable.",
            ),
          );
        }

        refreshVersions(publishedPrompt);
        toast.success(
          `Version ${publishedPrompt.versionTag} is now live.`,
        );
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to publish prompt.",
        );
      }
    });
  };

  const saveRollout = async (versionId: string, status: RolloutStatus, percentage: number) => {
    if (!prompt?.promptId || !activeWorkspaceId || rolloutSaving) return;
    setRolloutSaving(true);
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/rollout?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptVersionId: versionId, rolloutStatus: status, rolloutPercentage: percentage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save rollout");

      // Re-fetch distribution
      const r2 = await fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/rollout?workspaceId=${encodeURIComponent(activeWorkspaceId)}`);
      const d2 = await r2.json();
      if (d2 && Array.isArray(d2.versions)) setRolloutDist(d2 as PromptRolloutDistribution);

      const vTag = d2?.versions?.find((v: { promptVersionId: string; versionTag: string }) => v.promptVersionId === versionId)?.versionTag
        ?? rolloutDist?.versions.find(v => v.promptVersionId === versionId)?.versionTag
        ?? versionId;

      // Check if this resulted in an active promotion (direct or via 100% candidate)
      const resultedInActive = status === "active"
        || (status === "candidate" && percentage >= 100);

      if (resultedInActive) {
        // Find the most recent completed evaluation run for this version
        let evalRunId: string | null = null;
        if (activeWorkspaceId) {
          try {
            const evalRes = await fetch(`/api/evaluations/trace-sets?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
            if (evalRes.ok) {
              const evalRuns = await evalRes.json() as Array<{ id: string; candidatePromptVersionId?: string; aggregate?: { recommendation?: string }; status?: string }>;
              const linked = evalRuns.find(r =>
                r.candidatePromptVersionId === versionId &&
                r.aggregate?.recommendation === "ready_for_rollout" &&
                r.status === "completed"
              );
              evalRunId = linked?.id ?? null;
            }
          } catch { /* non-critical */ }
        }
        setRolloutComplete({ versionTag: vTag, versionId, evalRunId });
      } else if (status === "candidate") {
        toast.success(`Version ${vTag} set to candidate at ${percentage}% traffic.`);
      } else if (status === "deprecated") {
        toast.info(`Version ${vTag} deprecated.`);
      } else if (status === "blocked") {
        toast.warning(`Version ${vTag} blocked.`);
      } else {
        toast.success(`Version ${vTag} status updated.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save rollout");
    } finally {
      setRolloutSaving(false);
    }
  };

  const savePolicy = async (patch: Partial<PromptReleasePolicy>) => {
    if (!prompt?.promptId || !activeWorkspaceId || policySaving) return;
    setPolicySaving(true);
    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/policy?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save policy");
      setPolicy(data as PromptReleasePolicy);
      toast.success("Release policy saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setPolicySaving(false);
    }
  };

  const copyImportCode = () => {
    if (!latestPublished) return;
    const code = `client.get_prompt("${latestPublished.name}")`;
    navigator.clipboard.writeText(code);
    toast.success("Import code copied to clipboard.");
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] animate-fade-in">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">
                {currentPrompt.name}
              </h2>
              <Badge variant="outline">{currentPrompt.versionTag}</Badge>
              <Badge
                variant={currentPrompt.isPublished ? "success" : "secondary"}
              >
                {currentPrompt.isPublished ? "Published" : "Draft"}
              </Badge>
              {currentPrompt.lifecycleStatus && (
                <Badge
                  variant={
                    currentPrompt.lifecycleStatus === "active" ? "success"
                    : currentPrompt.lifecycleStatus === "blocked" || currentPrompt.lifecycleStatus === "deprecated" ? "destructive"
                    : currentPrompt.lifecycleStatus === "candidate" ? "warning"
                    : "secondary"
                  }
                >
                  {currentPrompt.lifecycleStatus}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {currentPrompt.description ??
                "No prompt description has been added yet."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {summarizeVersionState(currentPrompt, latestPublished)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={savePrompt}
              disabled={isPending || !isViewingCurrentDraft || !canEdit}
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {currentPrompt.isPublished
                ? "Save as New Draft"
                : "Save Draft"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={publishPrompt}
              disabled={
                isPublishPending ||
                !isViewingCurrentDraft ||
                currentPrompt.isPublished ||
                !canEdit
              }
            >
              {isPublishPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {currentPrompt.isPublished ? "Published" : "Publish"}
            </Button>
          </div>
        </div>

        {!isViewingCurrentDraft && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            You are viewing a historical snapshot. Switch back to the current
            draft to edit or publish changes.
          </div>
        )}

        <Tabs defaultValue="editor" className="w-full">
          <TabsList>
            <TabsTrigger value="editor">
              <FileCode2 className="mr-1.5 h-3.5 w-3.5" />
              Editor
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Live Preview
            </TabsTrigger>
            <TabsTrigger value="rollout">
              <GitBranch className="mr-1.5 h-3.5 w-3.5" />
              Rollout
            </TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>System Prompt Template</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {variables.length > 0
                      ? `${variables.length} variable${variables.length === 1 ? "" : "s"}: ${variables.map((v) => `{{${v}}}`).join(", ")}`
                      : "No template variables detected."}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileCode2 className="h-4 w-4" />
                  {isViewingCurrentDraft ? "Editable" : "Read-only"}
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
                  <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                    <span>prompt.template</span>
                    <span>{selectedVersion.versionTag}</span>
                  </div>
                  <div className="bg-background p-4">
                    <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      Editable source
                    </p>
                    <div className="flex min-h-[360px]">
                      <LineNumbers text={templateText} />
                      <Textarea
                        value={templateText}
                        onChange={(e) => setTemplateText(e.target.value)}
                        disabled={!isViewingCurrentDraft || !canEdit}
                        className="min-h-[360px] flex-1 resize-none border-0 bg-transparent p-0 font-mono text-sm leading-7 text-foreground shadow-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-70"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Model Parameters</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Runtime parameters shipped with this prompt version.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                  Structured config
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Model
                    </label>
                    <Input
                      value={modelParameters.model}
                      onChange={(event) =>
                        setModelParameters((current) => ({ ...current, model: event.target.value }))
                      }
                      placeholder="gpt-4o-mini"
                      disabled={!isViewingCurrentDraft || !canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Temperature
                    </label>
                    <Input
                      value={modelParameters.temperature}
                      onChange={(event) =>
                        setModelParameters((current) => ({ ...current, temperature: event.target.value }))
                      }
                      placeholder="0.2"
                      disabled={!isViewingCurrentDraft || !canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Top P
                    </label>
                    <Input
                      value={modelParameters.topP}
                      onChange={(event) =>
                        setModelParameters((current) => ({ ...current, topP: event.target.value }))
                      }
                      placeholder="0.95"
                      disabled={!isViewingCurrentDraft || !canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Max Tokens
                    </label>
                    <Input
                      value={modelParameters.maxTokens}
                      onChange={(event) =>
                        setModelParameters((current) => ({ ...current, maxTokens: event.target.value }))
                      }
                      placeholder="512"
                      disabled={!isViewingCurrentDraft || !canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Seed
                    </label>
                    <Input
                      value={modelParameters.seed}
                      onChange={(event) =>
                        setModelParameters((current) => ({ ...current, seed: event.target.value }))
                      }
                      placeholder="42"
                      disabled={!isViewingCurrentDraft || !canEdit}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Stop Sequences
                    </label>
                    <Input
                      value={modelParameters.stopSequences}
                      onChange={(event) =>
                        setModelParameters((current) => ({ ...current, stopSequences: event.target.value }))
                      }
                      placeholder="END, ###"
                      disabled={!isViewingCurrentDraft || !canEdit}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    RAG Names
                  </label>
                  <Input
                    value={modelParameters.ragSources}
                    onChange={(event) =>
                      setModelParameters((current) => ({ ...current, ragSources: event.target.value }))
                    }
                    placeholder="knowledge-base-prod, policies-v2"
                    disabled={!isViewingCurrentDraft || !canEdit}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use comma-separated names. These are saved as <code>rag_sources</code>.
                  </p>
                </div>
              </CardContent>
            </Card>

          </TabsContent>

          <TabsContent value="rollout" className="space-y-4">
            {rolloutComplete && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/8 px-5 py-5 space-y-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="font-semibold text-emerald-300">Rollout complete</p>
                    <p className="text-sm text-emerald-200/80">
                      Version <strong>{rolloutComplete.versionTag}</strong> is now Active — all traffic is routed to this version.
                      The previous active version has been marked Deprecated.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rolloutComplete.evalRunId && (
                    <a
                      href={`/evaluations/${encodeURIComponent(rolloutComplete.evalRunId)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      View evaluation report
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setRolloutComplete(null)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    Back to rollout
                  </button>
                </div>
              </div>
            )}
            {!rolloutDist ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading rollout data...
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground space-y-1 mb-4">
                  <p className="font-semibold text-foreground">Rollout workflow</p>
                  <ol className="list-decimal ml-4 space-y-0.5">
                    <li>Run evaluation against the candidate version.</li>
                    <li>Set version status to <strong>Candidate</strong>.</li>
                    <li>Start at 10% rollout percentage.</li>
                    <li>Monitor metrics on the Dashboard.</li>
                    <li>Increase rollout percentage gradually.</li>
                    <li>At 100%, the candidate automatically becomes Active.</li>
                    <li>Revert by setting percentage to 0 or status to Draft.</li>
                  </ol>
                </div>

                {!rolloutDist.activeVersionId && (
                  <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                    ⚠ No active version. Runtime will return an error until a version is set to Active.
                  </div>
                )}

                <div className="space-y-2">
                  {rolloutDist.versions.map((v) => {
                    const isBlocked = v.rolloutStatus === "blocked" || v.lifecycleStatus === "blocked";
                    const hasReadyEval = readyVersionIds.has(v.promptVersionId);
                    // canSet* gates only block/deprecated — the server enforces the eval gate
                    // and returns a clear toast error; the UI should not hard-disable the controls
                    const canSetCandidate = !isBlocked && v.rolloutStatus !== "active" && v.rolloutStatus !== "deprecated";
                    const canSetActive = !isBlocked && v.rolloutStatus !== "deprecated";

                    return (
                      <div key={v.promptVersionId} className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{v.versionTag}</span>
                            {v.isPublished && (
                              <Badge variant="success" className="text-[10px]">Published</Badge>
                            )}
                            <Badge
                              variant={
                                v.rolloutStatus === "active" ? "success"
                                : v.rolloutStatus === "candidate" ? "warning"
                                : v.rolloutStatus === "blocked" ? "destructive"
                                : v.rolloutStatus === "deprecated" ? "secondary"
                                : "outline"
                              }
                              className="text-[10px] capitalize"
                            >
                              {v.rolloutStatus}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {v.rolloutStatus === "active" && "← all non-candidate traffic"}
                            {v.rolloutStatus === "candidate" && `${v.rolloutPercentage}% of traffic`}
                            {v.rolloutStatus === "deprecated" && "no traffic"}
                            {v.rolloutStatus === "draft" && "not in runtime"}
                            {v.rolloutStatus === "blocked" && "blocked — no traffic"}
                          </div>
                        </div>

                        {canEdit && (
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="space-y-1">
                              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Status</div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    disabled={rolloutSaving || isBlocked}
                                    title={isBlocked ? "This version is blocked. Cannot change status." : undefined}
                                    className="flex h-8 min-w-[130px] items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <span className="capitalize">{v.rolloutStatus}</span>
                                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuPanel>
                                  <DropdownMenuRadioGroup
                                    value={v.rolloutStatus}
                                    onValueChange={(val) => {
                                      if (!rolloutSaving && !isBlocked) {
                                        void saveRollout(v.promptVersionId, val as RolloutStatus, v.rolloutPercentage);
                                      }
                                    }}
                                  >
                                    <DropdownMenuPanelRadioItem value="draft">Draft</DropdownMenuPanelRadioItem>
                                    <DropdownMenuPanelRadioItem value="candidate" disabled={!canSetCandidate}>
                                      Candidate
                                    </DropdownMenuPanelRadioItem>
                                    <DropdownMenuPanelRadioItem value="active" disabled={!canSetActive}>
                                      Active
                                    </DropdownMenuPanelRadioItem>
                                    <DropdownMenuPanelRadioItem value="deprecated">Deprecated</DropdownMenuPanelRadioItem>
                                    <DropdownMenuPanelRadioItem value="blocked">Blocked</DropdownMenuPanelRadioItem>
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuPanel>
                              </DropdownMenu>
                            </div>

                            {v.rolloutStatus === "candidate" && (
                              <div className="space-y-1">
                                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Traffic %</div>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={5}
                                    value={v.rolloutPercentage}
                                    className="w-28"
                                    disabled={rolloutSaving}
                                    onChange={(e) => void saveRollout(v.promptVersionId, v.rolloutStatus, parseInt(e.target.value, 10))}
                                  />
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-xs tabular-nums"
                                    value={v.rolloutPercentage}
                                    disabled={rolloutSaving}
                                    onChange={(e) => void saveRollout(v.promptVersionId, v.rolloutStatus, parseInt(e.target.value, 10) || 0)}
                                  />
                                  <span className="text-xs text-muted-foreground">%</span>
                                </div>
                                {v.rolloutPercentage >= 100 && (
                                  <p className="text-[10px] text-emerald-400">Will auto-activate on save</p>
                                )}
                              </div>
                            )}

                            <div className="flex gap-2 ml-auto">
                              {v.rolloutStatus === "draft" && !isBlocked && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7"
                                  onClick={() => void saveRollout(v.promptVersionId, "candidate", 10)}
                                  disabled={rolloutSaving}
                                >
                                  Promote to Candidate (10%)
                                </Button>
                              )}
                              {v.rolloutStatus === "candidate" && !isBlocked && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7"
                                  onClick={() => void saveRollout(v.promptVersionId, "candidate", 0)}
                                  disabled={rolloutSaving}
                                >
                                  Revert to 0%
                                </Button>
                              )}
                              {v.rolloutStatus === "candidate" && !isBlocked && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7 text-emerald-600 border-emerald-500/40"
                                  onClick={() => void saveRollout(v.promptVersionId, "active", 0)}
                                  disabled={rolloutSaving}
                                >
                                  Full Rollout (Active)
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        {isBlocked && (
                          <p className="text-xs text-destructive">This version is blocked. Resolve the block before making changes.</p>
                        )}
                        {!isBlocked && !hasReadyEval && v.rolloutStatus === "draft" && (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2">
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-400" />
                            <p className="text-xs text-amber-300">
                              No passing evaluation yet.{" "}
                              <a href={`/evaluations?org=${encodeURIComponent(activeWorkspaceId ?? "")}`} className="underline hover:text-amber-200">
                                Run an evaluation
                              </a>{" "}
                              to get a <strong>ready for rollout</strong> verdict. You can still promote manually — the server will enforce the gate.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Candidate traffic total: {rolloutDist.totalCandidatePercentage}%</span>
                  {rolloutDist.totalCandidatePercentage > 100 && (
                    <span className="ml-2 text-red-400">⚠ Exceeds 100% — fix before runtime traffic is split</span>
                  )}
                  {rolloutSaving && <span className="ml-2 animate-pulse">Saving...</span>}
                </div>

                {/* ── Release Policy Editor ── */}
                <div className="mt-6 rounded-xl border border-border bg-card overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold">Release Policy</span>
                    {policySaving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
                  </div>
                  <div className="px-4 py-4 space-y-4 text-xs">
                    <p className="text-muted-foreground">Define the evaluation gates that must pass before a version can be promoted.</p>

                    {/* Min score */}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-medium">Minimum score</div>
                        <div className="text-muted-foreground">Required aggregate eval score (0–100%)</div>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-xs tabular-nums text-right"
                        value={policy?.minScore != null ? Math.round(policy.minScore * 100) : 78}
                        disabled={!canEdit || policySaving}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v)) void savePolicy({ minScore: v / 100 });
                        }}
                      />
                    </div>

                    {/* Toggles */}
                    {([
                      ["requireCriticalPass", "Require critical checks pass", "Block promotion if any critical check fails"],
                      ["requireNoSafetyFailures", "Require no safety failures", "Block promotion if any safety check fails"],
                      ["blockOnAnyFailure", "Block on any failure", "Zero-tolerance: block if even one item fails"],
                      ["requireJsonValid", "Require valid JSON output", "Block if structured output is malformed"],
                    ] as Array<[keyof PromptReleasePolicy, string, string]>).map(([key, label, description]) => (
                      <div key={key} className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-medium">{label}</div>
                          <div className="text-muted-foreground">{description}</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(policy?.[key] ?? (key === "requireCriticalPass" || key === "requireNoSafetyFailures"))}
                          disabled={!canEdit || policySaving}
                          onClick={() => void savePolicy({ [key]: !(policy?.[key] ?? (key === "requireCriticalPass" || key === "requireNoSafetyFailures")) })}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                            (policy?.[key] ?? (key === "requireCriticalPass" || key === "requireNoSafetyFailures")) ? "bg-primary" : "bg-muted"
                          }`}
                        >
                          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${
                            (policy?.[key] ?? (key === "requireCriticalPass" || key === "requireNoSafetyFailures")) ? "translate-x-4" : "translate-x-0"
                          }`} />
                        </button>
                      </div>
                    ))}

                    {/* Max regressions */}
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-medium">Max regressions allowed</div>
                        <div className="text-muted-foreground">Items that perform worse than baseline</div>
                      </div>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-xs tabular-nums text-right"
                        value={policy?.maxRegressionCount ?? 0}
                        disabled={!canEdit || policySaving}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v >= 0) void savePolicy({ maxRegressionCount: v });
                        }}
                      />
                    </div>

                    {!policy && (
                      <p className="text-[10px] text-muted-foreground/60 italic">Showing defaults — policy will be saved to database on first edit.</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="preview">
            <Card>
              <CardHeader>
                <CardTitle>Live Rendered Preview</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Template variables are substituted with current parameter
                  values.
                </p>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                    <span>rendered output</span>
                    <span>{selectedVersion.versionTag}</span>
                  </div>
                  <div className="p-6">
                    <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-foreground">
                      {renderPreview(templateText, parsedParameters)}
                    </pre>
                  </div>
                </div>
                {variables.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {variables.map((v) => {
                      const hasValue =
                        parsedParameters !== null && v in parsedParameters;
                      return (
                        <Badge
                          key={v}
                          variant={hasValue ? "success" : "warning"}
                        >
                          {`{{${v}}}`}
                          {hasValue ? " = " + String(parsedParameters![v]) : " (unset)"}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <div className="space-y-6">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Version History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative space-y-0">
              {versions.map((version, i) => {
                const active =
                  version.promptVersionId === selectedVersionId;
                const isCurrent =
                  version.promptVersionId ===
                  currentPrompt.promptVersionId;
                const isLast = i === versions.length - 1;

                return (
                  <div key={version.promptVersionId} className="relative flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : version.isPublished
                              ? "border-emerald-500 bg-emerald-500/20 text-emerald-500"
                              : "border-border bg-muted text-muted-foreground"
                        }`}
                      >
                        {version.isPublished ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Circle className="h-3 w-3" />
                        )}
                      </div>
                      {!isLast && (
                        <div className="w-px flex-1 bg-border" />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedVersionId(version.promptVersionId)
                      }
                      className={`mb-3 w-full rounded-lg border p-3 text-left transition-all ${
                        active
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-transparent hover:border-border hover:bg-accent/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {version.versionTag}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {version.isPublished ? (
                            <Badge variant="success" className="text-[10px]">
                              Published
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="text-[10px]"
                            >
                              Draft
                            </Badge>
                          )}
                          {isCurrent && (
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                            >
                              Current
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 className="h-3 w-3" />
                        {relativeTime(version.createdAt)}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4" />
              Developer Import
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Only published versions can be imported into application code.
            </p>
            <div className="group relative overflow-hidden rounded-xl border border-border bg-muted/30 p-4 font-mono text-sm">
              {latestPublished ? (
                <>
                  <code>
                    {`client.get_prompt("${latestPublished.name}")`}
                  </code>
                  <span className="ml-2 text-muted-foreground">
                    {`// ${latestPublished.versionTag}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={copyImportCode}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">
                  No published version available for import.
                </span>
              )}
            </div>
            {!latestPublished && (
              <div className="flex items-center gap-2 text-sm text-amber-400">
                <Lock className="h-4 w-4" />
                Draft prompts are hidden from runtime import paths.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Auto-eval Status ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-primary" />
              Auto-evaluation
            </CardTitle>
            <CardDescription>
              Latest evaluation run for{" "}
              <span className="font-medium text-foreground">
                {currentPrompt.versionTag}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {autoEvalRun === "loading" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking…
              </div>
            ) : autoEvalRun === null ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <Circle className="h-2.5 w-2.5" />
                    No evaluation yet
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No evaluation has been run for this version. Auto-eval triggers
                  when a version is promoted to{" "}
                  <strong className="text-foreground">candidate</strong> status
                  and a linked dataset exists.
                </p>
                <a
                  href={`/evaluations?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <Sparkles className="h-3 w-3" />
                  Run an evaluation
                </a>
              </div>
            ) : (
              (() => {
                const rec = autoEvalRun.recommendation;
                const status = autoEvalRun.status;

                type BadgeShape = {
                  label: string;
                  icon: React.ReactNode;
                  cls: string;
                };

                const badge: BadgeShape =
                  status === "running" || status === "pending"
                    ? {
                        label: status === "running" ? "Running" : "Queued",
                        icon: <Loader2 className="h-2.5 w-2.5 animate-spin" />,
                        cls: "border-blue-500/40 bg-blue-500/10 text-blue-300",
                      }
                    : status === "failed"
                      ? {
                          label: "Run failed",
                          icon: <XCircle className="h-2.5 w-2.5" />,
                          cls: "border-red-500/40 bg-red-500/10 text-red-400",
                        }
                      : rec === "ready_for_rollout"
                        ? {
                            label: "Passed",
                            icon: <CheckCircle2 className="h-2.5 w-2.5" />,
                            cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                          }
                        : rec === "needs_improvement"
                          ? {
                              label: "Needs improvement",
                              icon: <AlertTriangle className="h-2.5 w-2.5" />,
                              cls: "border-amber-500/40 bg-amber-500/10 text-amber-300",
                            }
                          : rec === "blocked"
                            ? {
                                label: "Blocked",
                                icon: <XCircle className="h-2.5 w-2.5" />,
                                cls: "border-red-500/40 bg-red-500/10 text-red-400",
                              }
                            : {
                                label: rec?.replaceAll("_", " ") ?? "Unknown",
                                icon: <Circle className="h-2.5 w-2.5" />,
                                cls: "border-border bg-muted/60 text-muted-foreground",
                              };

                const isStale =
                  autoEvalRun.createdAt &&
                  Date.now() - new Date(autoEvalRun.createdAt).getTime() >
                    7 * 24 * 60 * 60 * 1000;

                return (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${badge.cls}`}
                      >
                        {badge.icon}
                        {badge.label}
                      </span>
                      {isStale && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/8 px-2 py-0.5 text-[10px] text-amber-400">
                          <Clock3 className="h-2.5 w-2.5" />
                          Stale
                        </span>
                      )}
                    </div>

                    <dl className="space-y-1.5 text-xs">
                      {autoEvalRun.score !== null && (
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Score</dt>
                          <dd className="font-medium tabular-nums">
                            {Math.round(autoEvalRun.score * 100)}%
                          </dd>
                        </div>
                      )}
                      {autoEvalRun.triggerReason && (
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Trigger</dt>
                          <dd className="font-medium capitalize">
                            {autoEvalRun.triggerReason.replaceAll("_", " ")}
                          </dd>
                        </div>
                      )}
                      {autoEvalRun.createdAt && (
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Run time</dt>
                          <dd className="text-muted-foreground">
                            {relativeTime(autoEvalRun.createdAt)}
                          </dd>
                        </div>
                      )}
                    </dl>

                    <a
                      href={`/evaluations/${encodeURIComponent(autoEvalRun.id)}?org=${encodeURIComponent(activeWorkspaceId ?? "")}`}
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <Sparkles className="h-3 w-3" />
                      View full report
                    </a>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
