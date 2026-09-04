import { parseQuery, RUN_FIELDS, type ParsedQuery } from "~/lib/query";

/**
 * Compile the query-bar AST into API parameters.
 *
 * THE POINT OF THIS FILE is the `unsupported` list, not the `params` object.
 *
 * `GET /api/runs` accepts exactly four things: `status`, `workflowId`, `page`
 * and `pageSize`. The query language accepts eleven fields. So `since:24h`,
 * `cost:>0.01`, `env:production`, `trigger:schedule`, `duration:>30s`,
 * `tokens:`, `steps:`, `incident:` and bare text have nowhere to go.
 *
 * There are two ways to handle that and only one of them is honest.
 *
 * The tempting one is to fetch a page and filter it in the browser. That
 * produces a table that is *wrong*, not merely incomplete: filtering page 1 of
 * 163,000 rows by `cost:>0.01` shows the expensive runs **on that page**, under
 * a heading that says it is showing the expensive runs. The count is wrong, the
 * pagination is wrong, and nothing on screen admits it. At 163 rows you might
 * not notice. At 163,000 it is a lie the UI tells confidently.
 *
 * So unsupported terms are NOT applied. They are returned, named, so the query
 * bar can say "cost is not filterable on the server yet" and leave the result
 * set honest. See API-GAPS.md.
 */

/** Fields `/api/runs` can actually filter on. */
const SERVER_FILTERABLE = new Set(["status", "workflow"]);

/**
 * Query-language status values → API status values.
 *
 * The two vocabularies differ (`succeeded` vs `completed`), and this is the
 * only place the query bar's spelling meets the API's.
 */
const STATUS_TO_API: Record<string, string> = {
  succeeded: "completed",
  failed: "failed",
  running: "running",
  queued: "queued",
  "awaiting-approval": "awaiting_approval",
  cancelled: "cancelled",
};

export interface CompiledQuery {
  /** Parameters safe to send to `/api/runs`. */
  params: {
    status?: string;
    workflowId?: string;
    page?: number;
    pageSize?: number;
  };
  /**
   * Terms the server cannot filter on.
   *
   * Non-empty means the result set is UNFILTERED with respect to these, and the
   * UI must say so rather than quietly showing more rows than the query asked
   * for.
   */
  unsupported: { key: string; value: string; reason: string }[];
  /** Parse errors, passed through so the input can highlight them. */
  errors: ParsedQuery["errors"];
}

export interface CompileOptions {
  page?: number;
  pageSize?: number;
  /**
   * Resolves a workflow NAME to an id.
   *
   * `workflow:renewals` is a substring match on a name; the API filters by
   * `workflowId` (a UUID). Without a resolver the term is unsupported rather
   * than wrong — the honest failure.
   */
  resolveWorkflowId?: (nameFragment: string) => string | null;
}

export function compileRunQuery(input: string, options: CompileOptions = {}): CompiledQuery {
  const parsed = parseQuery(input, RUN_FIELDS);
  const params: CompiledQuery["params"] = {};
  const unsupported: CompiledQuery["unsupported"] = [];

  if (options.page !== undefined) params.page = options.page;
  if (options.pageSize !== undefined) params.pageSize = options.pageSize;

  for (const term of parsed.terms) {
    if (term.error || term.value === "") continue;

    if (term.key === null) {
      unsupported.push({
        key: "text",
        value: term.value,
        reason: "Free-text search is not available on the server yet.",
      });
      continue;
    }

    if (!SERVER_FILTERABLE.has(term.key)) {
      unsupported.push({
        key: term.key,
        value: term.value,
        reason: `The API cannot filter runs by ${term.key} yet.`,
      });
      continue;
    }

    // A comparator the API has no way to express. `status:failed` is fine;
    // `status>failed` is not, and silently downgrading it to equality would
    // answer a different question than the one asked.
    if (term.comparator !== ":") {
      unsupported.push({
        key: term.key,
        value: term.value,
        reason: `${term.key} only supports exact match on the server.`,
      });
      continue;
    }

    if (term.key === "status") {
      const apiStatus = STATUS_TO_API[term.value];
      if (!apiStatus) {
        unsupported.push({
          key: "status",
          value: term.value,
          reason: `"${term.value}" is not a status the API recognises.`,
        });
        continue;
      }
      params.status = apiStatus;
      continue;
    }

    if (term.key === "workflow") {
      const id = options.resolveWorkflowId?.(term.value) ?? null;
      if (!id) {
        unsupported.push({
          key: "workflow",
          value: term.value,
          reason: `No workflow matches "${term.value}", or the workflow list has not loaded.`,
        });
        continue;
      }
      params.workflowId = id;
    }
  }

  return { params, unsupported, errors: parsed.errors };
}

/**
 * One sentence for the UI when part of a query could not be pushed down.
 *
 * Deliberately blunt. "Some filters could not be applied" invites the reader to
 * assume the rest is fine; naming them says exactly which columns are lying.
 */
export function describeUnsupported(unsupported: CompiledQuery["unsupported"]): string | null {
  if (unsupported.length === 0) return null;
  const names = unsupported.map((u) => u.key);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Showing results without the ${list} filter — the API cannot apply ${
    names.length === 1 ? "it" : "them"
  } yet.`;
}
