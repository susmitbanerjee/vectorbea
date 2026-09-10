import { describe, expect, it } from "vitest";
import { emptyHttpDraft, field, importCurl, requestPayload } from "~/lib/tools/http-client";
import { agentToolSpec, resolveTestDraft, variableNames, type AgentVariables } from "~/lib/tools/http-template";
import { inputSchema, specProblems } from "~/lib/tools/http-spec";

describe("agent HTTP templates", () => {
  const variables: AgentVariables = {
    id: { type: "string", description: "Customer id", testValue: "a/b?c" },
    query: { type: "string", description: "Search query", testValue: "hello & world" },
    source: { type: "string", description: "Needle", testValue: "ing" },
    count: { type: "integer", description: "Limit", testValue: "3" },
    enabled: { type: "boolean", description: "Enable option", testValue: "false" },
  };
  it("encodes path segments and query values independently", () => {
    const draft = { ...emptyHttpDraft(), url: "https://example.com/customers/{id}?q={{query}}" };
    const payload = requestPayload(resolveTestDraft(draft, variables));
    expect(payload.url).toContain("/customers/a%2Fb%3Fc?");
    expect(new URL(payload.url).searchParams.get("q")).toBe("hello & world");
  });
  it("keeps JSON values typed and never bakes in test values or credentials", () => {
    const draft = { ...emptyHttpDraft(), method: "POST", url: "https://example.com/customers/{id}", bodyType: "json" as const,
      body: '{"source":"{{source}}","count":"{{count}}","enabled":"{{enabled}}"}', auth: "api-key" as const, authName: "apy_token", authValue: "fixture-private-value" };
    const payload = requestPayload(resolveTestDraft(draft, variables));
    expect(JSON.parse(payload.body)).toEqual({ source: "ing", count: 3, enabled: false });
    const spec = agentToolSpec(draft, variables);
    expect(JSON.stringify(spec)).not.toContain("fixture-private-value");
    expect(JSON.stringify(spec)).not.toContain("a/b?c");
    expect(JSON.stringify(spec)).not.toContain('"testValue"');
    expect(inputSchema(spec)).toMatchObject({ properties: { count: { type: "integer" }, enabled: { type: "boolean" } }, required: ["id", "source", "count", "enabled"] });
    expect(spec.auth).toEqual({ strategy: "api_key_header", header: "apy_token", secretField: "value" });
    expect(specProblems(spec)).toEqual([]);
  });
  it("imports cURL placeholders and converts a custom token header to connection auth", () => {
    const draft = importCurl(`curl 'https://example.com/{{id}}?q={{query}}' -H 'apy_token: fixture-private-value' -H 'Content-Type: application/json' --data-raw '{"source":"{{source}}"}'`);
    expect(variableNames(draft)).toEqual(["id", "query", "source"]);
    const spec = agentToolSpec(draft, variables);
    expect(JSON.stringify(spec)).not.toContain("fixture-private-value");
    expect(spec.auth).toEqual({ strategy: "api_key_header", header: "apy_token", secretField: "value" });
    expect(specProblems(spec)).toEqual([]);
    expect(requestPayload(resolveTestDraft(draft, variables)).url).toContain("a%2Fb%3Fc");
  });
  it("requires typed test inputs but saves a template without test values", () => {
    const draft = { ...emptyHttpDraft(), url: "https://example.com/{id}" };
    expect(() => resolveTestDraft(draft, {})).toThrow("test value for id");
    expect(() => agentToolSpec(draft, {})).not.toThrow();
    const json = { ...draft, method: "POST", bodyType: "json" as const, body: '{"count":"{{count}}"}' };
    expect(() => resolveTestDraft(json, { ...variables, count: { ...variables.count!, testValue: "1.5" } })).toThrow("integer");
  });
  it("keeps fixed parameters bound and outside the agent schema", () => {
    const spec = agentToolSpec({ ...emptyHttpDraft(), url: "https://example.com/?fixed=false", query: [field("q", "{{query}}") ] }, variables);
    expect(inputSchema(spec)).toMatchObject({ properties: { query: { type: "string" } }, required: ["query"] });
    expect(Object.keys(inputSchema(spec).properties as object)).toEqual(["query"]);
  });
});
