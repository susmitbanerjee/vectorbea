"use client";

import { useEffect, useOptimistic, useState } from "react";

import { AppHeader } from "@/components/layout/app-header";
import { RbacGuard } from "@/components/rbac-guard";
import { CreatePromptDialog } from "@/components/prompts/create-prompt-dialog";
import { PromptsTable } from "@/components/prompts/prompts-table";
import type { PromptListItem } from "@/lib/api";

type PromptsShellProps = {
  initialPrompts: PromptListItem[];
  initialQuery: string;
};

export function PromptsShell({ initialPrompts, initialQuery }: PromptsShellProps) {
  const [prompts, setPrompts] = useState(initialPrompts);

  useEffect(() => {
    setPrompts(initialPrompts);
  }, [initialPrompts]);

  const [optimisticPrompts, addOptimisticPrompt] = useOptimistic(
    prompts,
    (currentPrompts, optimisticPrompt: PromptListItem) => [
      optimisticPrompt,
      ...currentPrompts.filter((prompt) => prompt.id !== optimisticPrompt.id),
    ],
  );

  const handlePromptCreated = (createdPrompt: PromptListItem, optimisticId?: string) => {
    setPrompts((currentPrompts) => [
      createdPrompt,
      ...currentPrompts.filter(
        (prompt) => prompt.id !== createdPrompt.id && prompt.id !== optimisticId,
      ),
    ]);
  };

  const handlePromptCreateFailed = (optimisticId: string) => {
    setPrompts((currentPrompts) =>
      currentPrompts.filter((prompt) => prompt.id !== optimisticId),
    );
  };

  const handlePromptDeleted = (deletedPromptId: string) => {
    setPrompts((currentPrompts) =>
      currentPrompts.filter((prompt) => prompt.id !== deletedPromptId),
    );
  };

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Prompts"
        subtitle="Registry of versioned prompts, policies, and model configurations."
        actions={
          <RbacGuard requiredRole="editor">
            <CreatePromptDialog
              onOptimisticCreate={addOptimisticPrompt}
              onPromptCreated={handlePromptCreated}
              onPromptCreateFailed={handlePromptCreateFailed}
              navigateOnSuccess={false}
            />
          </RbacGuard>
        }
      />
      <div className="px-4 py-6 md:px-6 xl:px-8">
        <PromptsTable
          prompts={optimisticPrompts}
          initialQuery={initialQuery}
          onPromptDeleted={handlePromptDeleted}
        />
      </div>
    </div>
  );
}
