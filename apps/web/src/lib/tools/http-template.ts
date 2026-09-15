import { field, isSecretName, splitRequestUrl, type HttpDraft, type RequestField } from "./http-client";
import type { SpecDocument, SpecInput } from "./http-spec";

export interface AgentVariable { type: "string" | "integer" | "number" | "boolean" | "array" | "object"; description: string; testValue: string }
export type AgentVariables = Record<string, AgentVariable>;
const pattern = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const decodeBraces = (value: string) => value.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
const names = (value: string) => [...decodeBraces(value).matchAll(pattern)].map((match) => match[1] ?? match[2]!);
const active = (rows: RequestField[]) => rows.filter((row) => row.enabled && row.name.trim());
export function variableNames(draft: HttpDraft): string[] {
  const texts = [draft.url, ...active(draft.query).filter((row) => !row.secret && !isSecretName(row.name)).map((row) => row.value),
    ...active(draft.headers).filter((row) => !row.secret && !isSecretName(row.name)).map((row) => row.value),
    ...(draft.bodyType === "json" || draft.bodyType === "raw" ? [draft.body] : []),
    ...(draft.bodyType === "form" || draft.bodyType === "multipart" ? active(draft.fields).filter((row) => !row.secret).map((row) => row.value) : [])];
  return [...new Set(texts.flatMap(names))];
}
function render(value: string, values: Record<string, unknown>, encode = (value: string) => value): string {
  return decodeBraces(value).replace(pattern, (_, double, single) => {
    const name = double ?? single;
    if (!(name in values)) throw new Error(`Enter a test value for ${name}.`);
    const v = values[name]; return encode(typeof v === "string" ? v : JSON.stringify(v));
  });
}
function jsonValues(value: unknown, values: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const sole = /^\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}$/.exec(value);
    if (sole) { if (!(sole[1]! in values)) throw new Error(`Enter a test value for ${sole[1]}.`); return values[sole[1]!]!; }
    return render(value, values);
  }
  if (Array.isArray(value)) return value.map((item) => jsonValues(item, values));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValues(item, values)]));
  return value;
}
function validatePlacement(draft: HttpDraft, variables: AgentVariables) {
  const strings = [draft.url, ...active(draft.query).map((row) => row.value), ...active(draft.headers).map((row) => row.value),
    ...(draft.bodyType === "form" || draft.bodyType === "multipart" ? active(draft.fields).map((row) => row.value) : [])];
  for (const name of strings.flatMap(names)) {
    if (variables[name]?.type === "array" || variables[name]?.type === "object") throw new Error(`${name}: use array and object inputs in JSON or raw bodies. Path, query, header and form inputs must be scalar.`);
  }
  if (draft.bodyType === "json") {
    const check = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(check);
      else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
        if (names(key).length) throw new Error("Keep JSON field names fixed; place placeholders in their values.");
        check(child);
      }
    };
    check(JSON.parse(draft.body));
  }
}
export function resolveTestDraft(draft: HttpDraft, variables: AgentVariables): HttpDraft {
  validatePlacement(draft, variables);
  splitRequestUrl(draft.url);
  const values: Record<string, unknown> = {};
  for (const name of variableNames(draft)) {
    const variable = variables[name];
    if (!variable || !variable.testValue.length) throw new Error(`Enter a test value for ${name}.`);
    let value: unknown = variable.testValue;
    if (variable.type !== "string") {
      try { value = JSON.parse(variable.testValue); } catch { throw new Error(`${name} must be a valid ${variable.type}.`); }
      const valid = variable.type === "integer" ? Number.isInteger(value) : variable.type === "array" ? Array.isArray(value) : variable.type === "object" ? !!value && typeof value === "object" && !Array.isArray(value) : typeof value === variable.type;
      if (!valid) throw new Error(`${name} must be a valid ${variable.type}.`);
    }
    values[name] = value;
  }
  const url = new URL(draft.url);
  if (names(url.origin).length) throw new Error("Agent variables cannot change the API host.");
  const query = [...url.searchParams].map(([name, value]) => field(name, render(value, values)));
  const resolvedUrl = url.origin + render(url.pathname, values, encodeURIComponent);
  const rows = (rows: RequestField[]) => rows.map((row) => row.enabled && !row.secret && !isSecretName(row.name) ? { ...row, value: render(row.value, values) } : row);
  return { ...draft, url: resolvedUrl, query: [...query, ...rows(draft.query)], headers: rows(draft.headers), fields: rows(draft.fields),
    body: draft.bodyType === "json" ? JSON.stringify(jsonValues(JSON.parse(draft.body), values)) : draft.bodyType === "raw" ? render(draft.body, values) : draft.body };
}

/** Convert placeholders, never test values, to the worker's existing HttpToolSpec. */
export function agentToolSpec(draft: HttpDraft, variables: AgentVariables): SpecDocument {
  validatePlacement(draft, variables);
  const secretHeaders = active(draft.headers).filter((row) => row.secret || isSecretName(row.name));
  if (draft.auth === "none" && secretHeaders.length === 1) {
    const header = secretHeaders[0]!;
    if (header.name.toLowerCase() === "authorization" && !/^Bearer /i.test(header.value)) throw new Error("Move Authorization to the matching authorization type before creating a tool.");
    const bearer = header.name.toLowerCase() === "authorization";
    draft = { ...draft, headers: draft.headers.filter((row) => row !== header), auth: bearer ? "bearer" : "api-key", authLocation: "header", authName: header.name, authValue: bearer ? header.value.slice(7) : header.value };
  }
  const url = new URL(draft.url);
  splitRequestUrl(draft.url);
  if (names(url.origin).length) throw new Error("Agent variables cannot change the API host.");
  const inputs: SpecInput[] = [];
  const add = (name: string, location: SpecInput["in"], wireName: string, templateBody = false) => {
    const existing = inputs.find((input) => input.name === name);
    if (existing) {
      if (templateBody || (existing.in === location && existing.wireName === wireName)) return;
      throw new Error(`${name} maps to multiple wire fields. Give each path, query or header input a distinct name.`);
    }
    inputs.push({ name, in: location, wireName, required: true, type: variables[name]?.type ?? "string", description: variables[name]?.description || undefined });
  };
  let nextConstant = 0;
  const allNames = new Set(variableNames(draft));
  const mapRow = (row: RequestField, location: SpecInput["in"]) => {
    if (row.fileBase64 !== undefined) throw new Error("Uploaded test files cannot be saved. Define an agent file input in the HTTP tool editor.");
    if (row.secret || isSecretName(row.name)) throw new Error(`Move ${row.name} to Authorization before creating a tool. Credentials are supplied by its saved connection.`);
    const vars = names(row.value);
    if (vars.length) {
      const sole = /^(?:\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\})$/.exec(row.value);
      if (!sole) throw new Error(`Use a whole placeholder for ${row.name}, such as {{value}}.`);
      add(sole[1] ?? sole[2]!, location, row.name);
    } else {
      let name: string; do { name = `fixed_${nextConstant++}`; } while (allNames.has(name));
      inputs.push({ name, in: location, wireName: row.name, constant: row.value });
    }
  };
  const path = decodeBraces(url.pathname);
  names(path).forEach((name) => add(name, "path", name));
  [...url.searchParams].map(([name, value]) => field(name, value)).concat(active(draft.query)).forEach((row) => mapRow(row, "query"));
  active(draft.headers).forEach((row) => mapRow(row, "header"));
  let body: Record<string, unknown> | undefined;
  if (draft.bodyType === "json" || draft.bodyType === "raw") {
    names(draft.body).forEach((name) => add(name, "body", name, true));
    body = { encoding: draft.bodyType, template: draft.bodyType === "json" ? JSON.parse(draft.body) : draft.body };
  } else if (draft.bodyType !== "none") {
    active(draft.fields).forEach((row) => mapRow(row, "body"));
    body = { encoding: draft.bodyType };
  }
  let auth: Record<string, unknown> = { strategy: "none" };
  if (draft.auth === "bearer") auth = { strategy: "bearer", secretField: "value" };
  if (draft.auth === "basic") auth = { strategy: "basic", username: draft.username, passwordSecretField: "value" };
  if (draft.auth === "api-key") {
    if (!draft.authName.trim()) throw new Error("Enter the API key name.");
    auth = draft.authLocation === "query" ? { strategy: "api_key_query", param: draft.authName, secretField: "value" } : { strategy: "api_key_header", header: draft.authName, secretField: "value" };
  }
  // Literal credentials in JSON are refused by the API secret scanner as well.
  if (draft.authValue && JSON.stringify({ inputs, body }).includes(draft.authValue)) throw new Error("Remove the credential from the request template. It belongs on the connection.");
  return { specVersion: 1, request: { method: draft.method, baseUrl: url.origin, path, inputs, ...(body ? { body } : {}) }, auth };
}
