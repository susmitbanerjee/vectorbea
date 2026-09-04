"use client";

import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useWorkspace } from "~/lib/workspace/workspace-provider";
import { isWorkspaceMembershipDenied, type VectorbeaApiError } from "./errors";
import { VectorbeaApiError as ApiError } from "./errors";
import { STALE_TIME } from "./keys";

/**
 * Query and mutation helpers.
 *
 * These exist for two reasons that would otherwise be copy-pasted into every
 * screen: routing a stale-workspace 403 back into the workspace provider, and
 * giving mutations a rollback that actually restores the previous cache entry
 * rather than refetching and hoping.
 */

export type ApiQueryOptions<TData> = Omit<
  UseQueryOptions<TData, ApiError, TData, QueryKey>,
  "queryKey" | "queryFn"
> & {
  queryKey: QueryKey;
  queryFn: () => Promise<TData>;
  /** Shorthand for the staleness policy in `keys.ts`. Defaults to "list". */
  freshness?: keyof typeof STALE_TIME;
};

export function useApiQuery<TData>(options: ApiQueryOptions<TData>): UseQueryResult<TData, ApiError> {
  const { freshness = "list", ...rest } = options;
  const { reportForbidden, workspaceId } = useWorkspace();

  const result = useQuery<TData, ApiError, TData, QueryKey>({
    ...rest,
    staleTime: rest.staleTime ?? STALE_TIME[freshness],
  });

  /**
   * A 403 on the current workspace means the selection is stale — the user was
   * removed, or the id came from a shared link they cannot open. Clear it and
   * re-resolve rather than leaving the screen wedged on an error it cannot
   * recover from. `reportForbidden` is idempotent per workspace, so this cannot
   * loop even though the effect reruns on every error render.
   */
  React.useEffect(() => {
    if (!result.error || !workspaceId) return;
    if (isWorkspaceMembershipDenied(result.error)) reportForbidden(workspaceId);
  }, [result.error, workspaceId, reportForbidden]);

  return result;
}

/**
 * Mutation with optimistic update and rollback.
 *
 * `optimistic` names the cache entry to patch and how. The previous value is
 * captured before the patch and restored verbatim on failure — restoring a
 * snapshot rather than refetching, because a refetch after a failed mutation
 * races the server's own write and can land on either value.
 */
export interface OptimisticConfig<TVariables, TSnapshot> {
  /** Cache entry to patch. */
  queryKey: QueryKey;
  /** Produce the optimistic value from the current one. */
  update: (current: TSnapshot | undefined, variables: TVariables) => TSnapshot | undefined;
  /** Keys to invalidate once the mutation settles, success or failure. */
  invalidate?: QueryKey[];
}

export type ApiMutationOptions<TData, TVariables, TSnapshot> = Omit<
  UseMutationOptions<TData, ApiError, TVariables, { previous: TSnapshot | undefined }>,
  "mutationFn"
> & {
  mutationFn: (variables: TVariables) => Promise<TData>;
  optimistic?: OptimisticConfig<TVariables, TSnapshot>;
};

export function useApiMutation<TData, TVariables = void, TSnapshot = unknown>(
  options: ApiMutationOptions<TData, TVariables, TSnapshot>,
): UseMutationResult<TData, ApiError, TVariables, { previous: TSnapshot | undefined }> {
  const queryClient = useQueryClient();
  const { optimistic, ...rest } = options;

  return useMutation<TData, ApiError, TVariables, { previous: TSnapshot | undefined }>({
    ...rest,

    // Rest parameters throughout: TanStack has changed the arity of these
    // callbacks across v5 minors (a mutation-scoped `context` was appended).
    // Forwarding whatever we were handed keeps this helper working across those
    // versions instead of pinning it to one signature.
    onMutate: async (...args) => {
      const [variables] = args;
      if (!optimistic) {
        await rest.onMutate?.(...args);
        return { previous: undefined };
      }

      // Cancel in-flight reads of this key first: a refetch that resolves after
      // the patch would overwrite the optimistic value with pre-mutation data.
      await queryClient.cancelQueries({ queryKey: optimistic.queryKey });

      const previous = queryClient.getQueryData<TSnapshot>(optimistic.queryKey);
      queryClient.setQueryData<TSnapshot>(optimistic.queryKey, (current) =>
        optimistic.update(current, variables),
      );

      await rest.onMutate?.(...args);
      return { previous };
    },

    onError: (...args) => {
      const onMutateResult = args[2];
      if (optimistic && onMutateResult) {
        queryClient.setQueryData(optimistic.queryKey, onMutateResult.previous);
      }
      rest.onError?.(...args);
    },

    onSettled: (...args) => {
      if (optimistic) {
        // Reconcile with the server, whichever way it went.
        void queryClient.invalidateQueries({ queryKey: optimistic.queryKey });
        for (const key of optimistic.invalidate ?? []) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
      rest.onSettled?.(...args);
    },
  });
}

export type { VectorbeaApiError };
