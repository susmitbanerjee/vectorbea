/**
 * The browser's view of an HTTP tool's definition.
 *
 * ── WHY THIS IS TYPES AND FUNCTIONS AND NOT A ZOD SCHEMA ────────────────────
 * The document's shape is owned by `HttpToolSpec.kt`, which the API and the
 * worker both compile precisely so there is exactly one reader. A Zod mirror
 * here would be a third definition, and the failure mode of a third definition
 * is specific and quiet: the editor saves a field the runtime does not read, the
 * form shows it back correctly, and the tool sends a request without it.
 *
 * So the browser treats the document as opaque JSON and reaches into it through
 * the narrow accessors below. When the Kotlin model grows a field, an editor
 * that does not know about it PASSES IT THROUGH untouched rather than dropping
 * it — which is the property that matters, and the one a mirrored schema would
 * destroy by stripping unknown keys.
 *
 * ── AND WHY THE EDITOR IS NOT A JSON TEXTAREA ───────────────────────────────
 * The acceptance criterion is that a POST with a JSON body, an api_key header
 * and a nested response extraction is configurable "entirely through the UI with
 * no code". A textarea of JSON is code. These types exist so the form can be a
 * form.
 */

/** Anything the editor does not model is carried through unchanged. */
export type SpecDocument = Record<string, unknown>;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const INPUT_LOCATIONS = ["path", "query", "header", "body", "cookie"] as const;
export type InputLocation = (typeof INPUT_LOCATIONS)[number];

export const INPUT_TYPES = ["string", "integer", "number", "boolean", "array", "object"] as const;

export const BODY_ENCODINGS = ["none", "json", "form", "multipart", "raw", "passthrough"] as const;
export type BodyEncoding = (typeof BODY_ENCODINGS)[number];

export const AUTH_STRATEGIES = [
  "inherit", "none", "api_key_header", "api_key_query", "bearer", "basic",
  "oauth2_client_credentials", "oauth2_authorization_code", "hmac", "custom",
] as const;
export type AuthStrategy = (typeof AUTH_STRATEGIES)[number];

export const PAGINATION_STRATEGIES = ["none", "cursor", "offset", "page", "link_header"] as const;
export type PaginationStrategy = (typeof PAGINATION_STRATEGIES)[number];

export interface SpecInput {
  name: string;
  in: InputLocation;
  wireName?: string;
  required?: boolean;
  type?: string;
  description?: string;
  default?: unknown;
  /** Bound by the author. Not offered to the model, and always sent. */
  constant?: unknown;
  enum?: string[];
  explode?: boolean;
  bodyPath?: string;
  isFile?: boolean;
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

function obj(source: unknown): Record<string, unknown> {
  return source && typeof source === "object" && !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : {};
}

export function request(spec: SpecDocument | null | undefined): Record<string, unknown> {
  return obj(obj(spec ?? {}).request);
}

export function method(spec: SpecDocument | null | undefined): HttpMethod {
  const raw = String(request(spec).method ?? "GET").toUpperCase();
  return (HTTP_METHODS as readonly string[]).includes(raw) ? (raw as HttpMethod) : "GET";
}

export function path(spec: SpecDocument | null | undefined): string {
  return String(request(spec).path ?? "");
}

export function inputs(spec: SpecDocument | null | undefined): SpecInput[] {
  const raw = request(spec).inputs;
  return Array.isArray(raw) ? (raw as SpecInput[]) : [];
}

export function bodyEncoding(spec: SpecDocument | null | undefined): BodyEncoding {
  const body = obj(request(spec).body);
  if (!body.encoding) return "none";
  const raw = String(body.encoding);
  return (BODY_ENCODINGS as readonly string[]).includes(raw) ? (raw as BodyEncoding) : "none";
}

export function contentType(spec: SpecDocument | null | undefined): string {
  return String(obj(request(spec).body).contentType ?? "");
}

export function authStrategy(spec: SpecDocument | null | undefined): AuthStrategy {
  const raw = String(obj(obj(spec ?? {}).auth).strategy ?? "inherit");
  return (AUTH_STRATEGIES as readonly string[]).includes(raw) ? (raw as AuthStrategy) : "inherit";
}

export function auth(spec: SpecDocument | null | undefined): Record<string, unknown> {
  return obj(obj(spec ?? {}).auth);
}

export function response(spec: SpecDocument | null | undefined): Record<string, unknown> {
  return obj(obj(spec ?? {}).response);
}

export function extraction(spec: SpecDocument | null | undefined): {
  engine: "none" | "jsonpath" | "jmespath";
  expression: string;
} {
  const raw = obj(response(spec).extract);
  const engine = String(raw.engine ?? "none");
  return {
    engine: engine === "jsonpath" || engine === "jmespath" ? engine : "none",
    expression: String(raw.expression ?? ""),
  };
}

export function pagination(spec: SpecDocument | null | undefined): Record<string, unknown> {
  return obj(obj(spec ?? {}).pagination);
}

export function paginationStrategy(spec: SpecDocument | null | undefined): PaginationStrategy {
  const raw = String(pagination(spec).strategy ?? "none");
  return (PAGINATION_STRATEGIES as readonly string[]).includes(raw)
    ? (raw as PaginationStrategy)
    : "none";
}

export function retry(spec: SpecDocument | null | undefined): Record<string, unknown> {
  return obj(obj(spec ?? {}).retry);
}

export function transport(spec: SpecDocument | null | undefined): Record<string, unknown> {
  return obj(obj(spec ?? {}).transport);
}

/* ── Writing ──────────────────────────────────────────────────────────────── */

/**
 * Set one path inside the document, returning a new one.
 *
 * Everything the editor does not touch is copied forward, INCLUDING keys this
 * build has never heard of. That is what lets an older UI edit a document
 * written by a newer API without silently deleting half of it — the failure a
 * schema-validating form would produce, and the reason there is no schema here.
 */
export function setIn(
  spec: SpecDocument | null | undefined,
  keyPath: readonly string[],
  value: unknown,
): SpecDocument {
  if (keyPath.length === 0) return obj(value);
  const [head, ...rest] = keyPath;
  const current = obj(spec ?? {});
  const next: SpecDocument = { ...current };
  if (rest.length === 0) {
    if (value === undefined) delete next[head];
    else next[head] = value;
  } else {
    next[head] = setIn(obj(current[head]), rest, value);
  }
  return next;
}

/** A spec for a tool that has none yet, so the editor has something to show. */
export function emptySpec(): SpecDocument {
  return {
    specVersion: 1,
    request: { method: "GET", path: "/", inputs: [] },
    auth: { strategy: "inherit" },
  };
}

/** Model arguments follow the request mapping; author-bound values stay private. */
export function inputSchema(spec: SpecDocument): Record<string, unknown> {
  const visible = inputs(spec).filter((input) => input.constant == null);
  return {
    type: "object",
    properties: Object.fromEntries(visible.map((input) => [input.name, {
      type: input.type ?? "string",
      ...(input.description ? { description: input.description } : {}),
      ...(input.default !== undefined ? { default: input.default } : {}),
      ...(input.enum ? { enum: input.enum } : {}),
    }])),
    required: visible.filter((input) => input.required).map((input) => input.name),
  };
}

/**
 * The placeholders a path template needs.
 *
 * The editor uses this to tell an author which path inputs are missing BEFORE
 * they save, because the alternative is a vendor 404 at run time — the least
 * informative way to learn that an input was not mapped.
 */
export function pathPlaceholders(template: string): string[] {
  const found = template.match(/\{([^}]+)\}/g) ?? [];
  return Array.from(new Set(found.map((raw) => raw.slice(1, -1))));
}

/** Placeholders with no input mapped to them. Empty means the path is complete. */
export function unmappedPathParams(spec: SpecDocument | null | undefined): string[] {
  const supplied = new Set(
    inputs(spec).filter((i) => i.in === "path").map((i) => i.wireName ?? i.name),
  );
  return pathPlaceholders(path(spec)).filter((name) => !supplied.has(name));
}

/**
 * Problems that would make the runtime refuse or misroute the request.
 *
 * Client-side, and mirrored server-side by `ToolRoutes.validateHttpSpec` and by
 * the assembler itself — this copy exists so the answer arrives next to the
 * field rather than after a round trip, not because it is the one that counts.
 */
export function specProblems(spec: SpecDocument | null | undefined): string[] {
  const problems: string[] = [];

  const unmapped = unmappedPathParams(spec);
  if (unmapped.length > 0) {
    problems.push(
      `The path needs ${unmapped.map((n) => `\`${n}\``).join(", ")} and no input supplies ` +
        `${unmapped.length === 1 ? "it" : "them"}. Add an input with that wire name, mapped to the path.`,
    );
  }

  const names = inputs(spec).map((i) => i.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) {
    problems.push(
      `Two inputs are both called \`${duplicate}\`. The model sends one arguments ` +
        `object, so a duplicate name means one of them can never be supplied.`,
    );
  }
  const unnamed = inputs(spec).some((i) => !i.name?.trim());
  if (unnamed) problems.push("An input has no name. Name it, or remove it.");

  const encoding = bodyEncoding(spec);
  const hasBodyInputs = inputs(spec).some((i) => i.in === "body");
  if (encoding === "none" && hasBodyInputs) {
    problems.push(
      "Inputs are mapped to the body, but the body encoding is None, so they will " +
        "not be sent. Choose JSON, form or multipart.",
    );
  }
  if (encoding !== "none" && ["GET", "HEAD"].includes(method(spec))) {
    problems.push(
      `${method(spec)} requests do not carry a body. Change the method, or set the ` +
        "body encoding to None.",
    );
  }
  if (encoding === "multipart" && !inputs(spec).some((i) => i.in === "body" && i.isFile)) {
    problems.push(
      "The body is multipart but no input is marked as a file. Mark the file input, " +
        "or use form encoding.",
    );
  }

  const strategy = paginationStrategy(spec);
  const page = pagination(spec);
  if (strategy === "cursor" && !page.nextCursorPath) {
    problems.push(
      "Cursor pagination needs the path to the next cursor in the response. Without " +
        "it the runtime cannot ask for a second page.",
    );
  }
  if (strategy !== "none" && !page.itemsPath) {
    problems.push(
      "Pagination has no items path, so pages cannot be accumulated. Give the dotted " +
        "path to the array of records.",
    );
  }

  return problems;
}

/**
 * A one-line description of what this tool sends. For a summary row.
 *
 * The QUERY is deliberately absent even here: an api-key-in-query tool would put
 * a credential in it, and a summary line ends up in screenshots and tickets.
 */
export function requestSummary(spec: SpecDocument | null | undefined): string {
  const base = String(request(spec).baseUrl ?? "");
  return `${method(spec)} ${base}${path(spec)}`.trim();
}
