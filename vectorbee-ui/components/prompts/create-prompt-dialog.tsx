"use client";

import { useRouter, useSearchParams } from "next/navigation";
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

export function CreatePromptDialog() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPending, startTransition] = useTransition();

  const nameValid = name.trim().length >= 2;

  const createPrompt = () => {
    if (!nameValid) {
      toast.error("Prompt name must be at least 2 characters.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: searchParams.get("org"),
            name: name.trim(),
            description: description.trim() || null,
            versionTag: "v1.0.0",
            templateText: "You are VectorBee. Use {{user_input}} to answer clearly.",
            parameters: {
              model_name: "gpt-4.1-mini",
              temperature: 0.2,
              max_tokens: 512,
              top_p: 0.95,
            },
          }),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const created = (await response.json()) as { promptId: string };
        toast.success(`Prompt "${name.trim()}" created successfully.`);
        setName("");
        setDescription("");
        setOpen(false);
        router.refresh();
        router.push(
          `/prompts/${created.promptId}${searchParams.get("org") ? `?org=${searchParams.get("org")}` : ""}`,
        );
      } catch (cause) {
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
