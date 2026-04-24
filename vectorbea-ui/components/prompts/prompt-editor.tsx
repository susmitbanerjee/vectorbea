"use client";

import { useEffect, useMemo, useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Eye,
  FileCode2,
  History,
  Loader2,
  Lock,
  Save,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { type PromptDetail } from "@/lib/api";
import type { PromptRolloutDistribution, RolloutStatus } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    fetch(`/api/prompts/${encodeURIComponent(prompt.promptId)}/rollout?workspaceId=${encodeURIComponent(activeWorkspaceId)}`)
      .then(r => r.json())
      .then(d => {
        // Guard: only set state when the response is a valid distribution object.
        // An error response ({ error: "..." }) must not reach setRolloutDist
        // because the render calls rolloutDist.versions.map() unconditionally.
        if (!cancelled && d && Array.isArray(d.versions)) {
          setRolloutDist(d as PromptRolloutDistribution);
        }
      })
      .catch(() => {});
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
    } catch { /* silent */ } finally {
      setRolloutSaving(false);
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

            {rolloutDist && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Version Rollout</CardTitle>
                  <CardDescription className="text-xs">
                    Control traffic distribution across versions. Candidate versions receive a percentage slice; the active version handles the remainder.
                    Use deterministic routing via the <code className="text-[11px]">x-request-id</code> or <code className="text-[11px]">x-user-id</code> header.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    Total candidate traffic: <span className="font-medium text-foreground">{rolloutDist.totalCandidatePercentage}%</span>
                    {rolloutDist.totalCandidatePercentage > 100 && (
                      <span className="ml-2 text-red-400">⚠ Exceeds 100%</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {rolloutDist.versions.map((v) => (
                      <div key={v.promptVersionId} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <span className="text-xs font-medium">{v.versionTag}</span>
                          {v.isPublished && <span className="ml-2 text-[10px] text-green-400">published</span>}
                        </div>
                        <select
                          className="rounded border border-border bg-background px-2 py-1 text-xs"
                          value={v.rolloutStatus}
                          onChange={(e) => void saveRollout(v.promptVersionId, e.target.value as RolloutStatus, v.rolloutPercentage)}
                        >
                          <option value="draft">Draft</option>
                          <option value="candidate">Candidate</option>
                          <option value="active">Active</option>
                          <option value="deprecated">Deprecated</option>
                        </select>
                        {v.rolloutStatus === "candidate" && (
                          <input
                            type="number"
                            min={0}
                            max={100}
                            className="w-16 rounded border border-border bg-background px-2 py-1 text-xs tabular-nums"
                            value={v.rolloutPercentage}
                            onChange={(e) => void saveRollout(v.promptVersionId, v.rolloutStatus, parseInt(e.target.value, 10) || 0)}
                          />
                        )}
                        {v.rolloutStatus === "candidate" && (
                          <span className="text-xs text-muted-foreground">%</span>
                        )}
                        {v.rolloutStatus === "active" && (
                          <span className="text-xs text-green-400">receives all non-candidate traffic</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {rolloutSaving && <p className="text-xs text-muted-foreground">Saving...</p>}
                </CardContent>
              </Card>
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
      </div>
    </div>
  );
}
