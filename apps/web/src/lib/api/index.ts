/**
 * Public surface of the API layer.
 *
 * Screens should import from here, not from the individual modules — the split
 * between transport, client and hooks is an implementation detail, and keeping
 * it behind one entry point means it can change without a repo-wide edit.
 *
 * Server-only helpers (`./server`) are deliberately NOT re-exported: importing
 * them here would pull `next/headers` and `server-only` into every client
 * bundle that touches the API. Import `~/lib/api/server` directly from Server
 * Components.
 */

export { getApiBaseUrl, getDataMode, isMockMode, type DataMode } from "./config";

export {
  VectorbeaApiError,
  isBetaGated,
  isUnauthenticated,
  isVectorbeaApiError,
  isWorkspaceMembershipDenied,
  type ApiErrorBody,
  type ErrorIntent,
  type FailureKind,
} from "./errors";

export {
  createFetchTransport,
  type HttpMethod,
  type RequestOptions,
  type Transport,
  type TokenSource,
} from "./transport";

export { createMockTransport } from "./mock-transport";

export {
  createVectorbeaClient,
  type CurrentUser,
  type Paged,
  type PageParams,
  type RunListFilters,
  type Scope,
  type VectorbeaClient,
} from "./client";

export { validateResponse, onContractMismatch, type ContractMismatch } from "./validate";

export { queryKeys, STALE_TIME, type ScopeIds } from "./keys";
export { createQueryClient, createServerQueryClient, shouldRedirectToSignIn } from "./query-client";
export { QueryProvider } from "./query-provider";
export { ApiProvider, useApi } from "./api-provider";
export {
  useApiMutation,
  useApiQuery,
  type ApiMutationOptions,
  type ApiQueryOptions,
  type OptimisticConfig,
} from "./hooks";
