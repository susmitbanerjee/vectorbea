"use client";

import { useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FileText, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { PromptListItem } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RolloutStatus, derivePromptRollout } from "@/components/ui/rollout-status";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BeeLoader } from "@/components/ui/bee-loader";

type FilterTab = "all" | "published" | "draft";

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
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function PromptsTable({
  prompts,
  initialQuery,
  onPromptDeleted,
}: {
  prompts: PromptListItem[];
  initialQuery: string;
  onPromptDeleted?: (promptId: string) => void;
}) {
  const router = useRouter();
  const { activeWorkspaceId } = useWorkspace();
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<PromptListItem | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingPromptId, setPendingPromptId] = useState<string | null>(null);

  const promptHref = (promptId: string) =>
    `/prompts/${promptId}${activeWorkspaceId ? `?org=${encodeURIComponent(activeWorkspaceId)}` : ""}`;

  const prefetchPrompt = (promptId: string) => {
    router.prefetch(promptHref(promptId) as Route);
  };

  const openPrompt = (promptId: string) => {
    if (isPending) return;
    setPendingPromptId(promptId);
    startTransition(() => {
      router.push(promptHref(promptId) as Route);
    });
  };

  const counts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesQuery = (prompt: PromptListItem) =>
      !q ||
      [prompt.name, prompt.description ?? "", prompt.latestVersion].some((field) =>
        field.toLowerCase().includes(q),
      );

    return {
      all: prompts.filter(matchesQuery).length,
      published: prompts.filter((prompt) => matchesQuery(prompt) && prompt.isPublished).length,
      draft: prompts.filter((prompt) => matchesQuery(prompt) && !prompt.isPublished).length,
    };
  }, [prompts, query]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return prompts.filter((prompt) => {
      const matchesQuery =
        !value ||
        [prompt.name, prompt.description ?? "", prompt.latestVersion].some((field) =>
          field.toLowerCase().includes(value),
        );
      const matchesFilter =
        filter === "all" ||
        (filter === "published" ? prompt.isPublished : !prompt.isPublished);
      return matchesQuery && matchesFilter;
    });
  }, [filter, prompts, query]);

  const handleDelete = async (promptId: string) => {
    setDeletingId(promptId);

    try {
      const response = await fetch(
        `/api/prompts/${promptId}${activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : ""}`,
        { method: "DELETE" },
      );

      if (!response.ok && response.status !== 204) {
        const body = (await response.json().catch(() => ({ error: "Unknown error" }))) as {
          error?: string;
        };
        throw new Error(body.error || `Request failed (${response.status})`);
      }

      onPromptDeleted?.(promptId);
      toast.success("Prompt deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete prompt");
    } finally {
      setDeletingId(null);
      setConfirmPrompt(null);
    }
  };

  return (
    <>
      <Dialog
        open={Boolean(confirmPrompt)}
        onOpenChange={(open) => {
          if (!open) setConfirmPrompt(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete prompt</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{confirmPrompt?.name}</strong>? All versions
              will be deleted and cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmPrompt(null)}
              disabled={Boolean(deletingId)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmPrompt && handleDelete(confirmPrompt.id)}
              disabled={Boolean(deletingId)}
            >
              {deletingId ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="animate-fade-in">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle>Prompts</CardTitle>
            <p className="text-sm text-muted-foreground">
              {prompts.length} prompt{prompts.length === 1 ? "" : "s"} total
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="Search by name or description..."
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as FilterTab)}>
            <TabsList>
              <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
              <TabsTrigger value="published">Published ({counts.published})</TabsTrigger>
              <TabsTrigger value="draft">Draft ({counts.draft})</TabsTrigger>
            </TabsList>
          </Tabs>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center animate-fade-in">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No prompts found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {query.trim()
                    ? "Try adjusting your search or filter."
                    : "Create your first prompt to start versioning."}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rollout</TableHead>
                    <TableHead className="hidden md:table-cell">Description</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((prompt, index) => (
                    <TableRow
                      key={prompt.id}
                      className={`cursor-pointer transition-colors hover:bg-accent/50 animate-slide-up stagger-${Math.min(index + 1, 5)} ${
                        isPending ? "pointer-events-none opacity-70" : ""
                      } ${pendingPromptId === prompt.id ? "bg-accent/40" : ""}`}
                      onMouseEnter={() => prefetchPrompt(prompt.id)}
                      onFocus={() => prefetchPrompt(prompt.id)}
                      onClick={() => openPrompt(prompt.id)}
                    >
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          {prompt.name}
                          {pendingPromptId === prompt.id && isPending ? (
                            <BeeLoader compact />
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{prompt.latestVersion}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={prompt.isPublished ? "success" : "secondary"}>
                          {prompt.isPublished ? "Published" : "Draft"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <RolloutStatus
                          {...derivePromptRollout(prompt)}
                          variant="inline"
                          size="sm"
                          className="w-full max-w-[180px]"
                        />
                      </TableCell>
                      <TableCell className="hidden max-w-xs truncate text-muted-foreground md:table-cell">
                        {prompt.description ?? "-"}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {relativeTime(prompt.updatedAt)}
                      </TableCell>
                      <TableCell
                        onClick={(event) => event.stopPropagation()}
                        className="text-right"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmPrompt(prompt)}
                          disabled={deletingId === prompt.id || isPending}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
