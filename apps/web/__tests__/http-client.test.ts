import { describe, expect, it } from "vitest";
import { emptyHttpDraft, field, importCurl, requestPayload, splitRequestUrl } from "~/lib/tools/http-client";

describe("HTTP request client", () => {
  it("imports the fuzzy-search request without losing query flags, custom auth or JSON", () => {
    const draft = importCurl(`curl 'https://api.eu.apyhub.com/apyhub/fuzzy-search?accent-insensitive=false&unicode-normalized=false' -H 'apy_token: test-credential' -H 'Content-Type: application/json' --data-raw '{"source":"ing","target":"finding things bring"}'`);
    const payload = requestPayload(draft);
    expect(payload.method).toBe("POST");
    expect(payload.url).toContain("accent-insensitive=false&unicode-normalized=false");
    expect(payload.headers.find((header) => header.name === "apy_token")).toMatchObject({ secret: true, value: "test-credential" });
    expect(JSON.parse(payload.body)).toEqual({ source: "ing", target: "finding things bring" });
  });
  it("preserves repeated query parameters and skips disabled rows", () => {
    const draft = { ...emptyHttpDraft(), ...splitRequestUrl("https://example.com?tag=a&tag=b&empty=") };
    draft.query.push({ ...field("ignored", "x"), enabled: false });
    expect(new URL(requestPayload(draft).url).search).toBe("?tag=a&tag=b&empty=");
  });
  it("puts an API key at the chosen location and redacts it", () => {
    const payload = requestPayload({ ...emptyHttpDraft(), url: "https://example.com", auth: "api-key", authLocation: "query", authName: "apy_token", authValue: "fixture" });
    expect(new URL(payload.url).searchParams.get("apy_token")).toBe("fixture");
    expect(payload.headers).toEqual([]);
    expect(payload.sensitiveValues).toContain("fixture");
  });
  it("rejects contradictory authorization instead of silently overriding it", () => {
    expect(() => requestPayload({ ...emptyHttpDraft(), url: "https://example.com", auth: "bearer", authValue: "fixture", headers: [field("authorization", "other")] })).toThrow("either Headers or Authorization");
  });
  it("supports form fields and Basic auth", () => {
    const draft = importCurl("curl https://example.com -u 'user:pass:word' --data-urlencode 'query=a & b'");
    expect(requestPayload(draft)).toMatchObject({ method: "POST", bodyType: "form", fields: [{ name: "query", value: "a & b" }] });
    expect(requestPayload(draft).headers[0]?.value).toBe(`Basic ${btoa("user:pass:word")}`);
  });
  it("imports multipart text fields", () => {
    expect(importCurl("curl https://example.com -F 'source=ing' --form-string 'target=finding things bring'")).toMatchObject({ method: "POST", bodyType: "multipart", fields: [{ name: "source" }, { name: "target" }] });
  });
  it.each([
    "curl https://example.com; echo unsafe",
    "curl https://example.com --insecure",
    "curl https://example.com -d @secret.txt",
    "curl https://example.com -F 'file=@secret.txt'",
    "curl https://example.com -H 'x: $(cat secret)'",
    "curl 'https://example.com",
    "curl https://example.com https://other.example.com",
  ])("refuses unsupported or ambiguous commands: %s", (command) => expect(() => importCurl(command)).toThrow());
  it("rejects invalid JSON and GET bodies before sending", () => {
    const draft = { ...emptyHttpDraft(), url: "https://example.com", bodyType: "json" as const, body: "no" };
    expect(() => requestPayload(draft)).toThrow("cannot carry a body");
    expect(() => requestPayload({ ...draft, method: "POST" })).toThrow("not valid JSON");
  });
  it("supports cURL GET query data without introducing a body", () => {
    const payload = requestPayload(importCurl("curl -G https://example.com --data-urlencode 'q=hello world'"));
    expect(payload.bodyType).toBe("none");
    expect(new URL(payload.url).searchParams.get("q")).toBe("hello world");
  });
});
