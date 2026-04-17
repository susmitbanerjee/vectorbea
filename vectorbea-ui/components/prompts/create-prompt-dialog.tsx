"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PromptListItem } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

async function getApiErrorMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

type CreatePromptDialogProps = {
  navigateOnSuccess?: boolean;
  onOptimisticCreate?: (prompt: PromptListItem) => void;
  onPromptCreated?: (prompt: PromptListItem, optimisticId?: string) => void;
  onPromptCreateFailed?: (optimisticId: string) => void;
};

export function CreatePromptDialog({
  navigateOnSuccess = true,
  onOptimisticCreate,
  onPromptCreated,
  onPromptCreateFailed,
}: CreatePromptDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();
  const { activeWorkspaceId } = useWorkspace();

  const nameValid = name.trim().length >= 2;

  const createPrompt = () => {
    if (!nameValid) {
      toast.error("Prompt name must be at least 2 characters.");
      return;
    }

    startTransition(async () => {
      const optimisticId = `optimistic-${crypto.randomUUID()}`;
      const optimisticPrompt: PromptListItem = {
        id: optimisticId,
        name: name.trim(),
        description: description.trim() || null,
        latestVersion: "v1.0.0",
        isPublished: false,
        updatedAt: new Date().toISOString(),
      };

      onOptimisticCreate?.(optimisticPrompt);

      try {
        const response = await fetch(
          `/api/prompts${activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: name.trim(),
              description: description.trim() || undefined,
            }),
          },
        );
        if (!response.ok) {
          throw new Error(
            await getApiErrorMessage(response, "Unable to create prompt right now."),
          );
        }
        const created = (await response.json()) as { id: string; promptId?: string };
        const createdPrompt: PromptListItem = {
          id: created.id ?? created.promptId ?? optimisticId,
          name: name.trim(),
          description: description.trim() || null,
          latestVersion: "v1.0.0",
          isPublished: false,
          updatedAt: new Date().toISOString(),
        };

        onPromptCreated?.(createdPrompt, optimisticId);
        toast.success(`Prompt "${name.trim()}" created successfully.`);
        setName("");
        setDescription("");
        setOpen(false);
        router.refresh();
        if (navigateOnSuccess) {
          router.push(
            `/prompts/${created.id ?? created.promptId}${activeWorkspaceId ? `?org=${encodeURIComponent(activeWorkspaceId)}` : ""}`,
          );
        }
      } catch (cause) {
        onPromptCreateFailed?.(optimisticId);
        toast.error(
          cause instanceof Error ? cause.message : "Failed to create prompt.",
        );
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Create Prompt
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create prompt</DialogTitle>
          <DialogDescription>
            A new prompt will be initialized with a starter template and default
            model parameters.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createPrompt();
          }}
          className="mt-4 space-y-4"
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. support-reply"
              autoFocus
            />
            {name.length > 0 && !nameValid && (
              <p className="text-xs text-destructive">
                Name must be at least 2 characters.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this prompt control?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !nameValid}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPending ? "Creating..." : "Create Prompt"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
