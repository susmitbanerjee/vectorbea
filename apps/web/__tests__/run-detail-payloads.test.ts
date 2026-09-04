import { describe, expect, it } from "vitest";
import { contracts } from "@vectorbea/shared";

/**
 * `outputJson` / `errorJson` ON THE RUN DETAIL RESPONSE.
 *
 * THE BUG THESE PIN
 * ─────────────────
 * `RunRoutes.toDetailResponse()` read `output_json` / `error_json` as raw jsonb
 * column TEXT and put it straight into the response map, so Jackson escaped it
 * and the field arrived as a STRING of JSON:
 *
 *     "errorJson": "{\"code\":\"WORKER_ERROR\"}"
 *
 * The contract said `z.record(...)`, which rejected it with "Expected object,
 * received string". Because the transport validates the whole response as a
 * unit, that one field failed the entire payload and the run detail screen
 * rendered "The API returned data this version of the app cannot read" — for a
 * FAILED run, which is the one case the screen exists to explain.
 *
 * The API now decodes the column. These tests do not duplicate that fix; they
 * pin the client half, which has to hold independently: web ships from Vercel
 * and the API from Railway on separate deploys, so a browser routinely runs
 * against an API one deploy behind, and the encoded form must keep working.
 */

const base = {
  id: "0189d3f6-2a4c-7c11-9f0a-8f4f2a1b6c11",
  workspaceId: "0189d3f6-2a4c-7c11-9f0a-8f4f2a1b6c12",
  environmentId: "0189d3f6-2a4c-7c11-9f0a-8f4f2a1b6c13",
  workflowId: "0189d3f6-2a4c-7c11-9f0a-8f4f2a1b6c14",
  workflowVersionId: "0189d3f6-2a4c-7c11-9f0a-8f4f2a1b6c15",
  status: "failed",
  triggerType: "manual",
  createdAt: "2026-08-26T01:23:01.449079Z",
  updatedAt: "2026-08-26T01:23:04.273828Z",
  hasOutput: false,
  hasError: true,
  nodeCommitted: 2,
  ribbonJson: '[{"n":"start","s":"committed"}]',
};

describe("runDetail payload columns", () => {
  it("accepts errorJson as an object (the API's current form)", () => {
    const parsed = contracts.runDetail.parse({
      ...base,
      errorJson: { code: "WORKER_ERROR", message: "Node agent-1 failed" },
    });

    expect(parsed.errorJson).toEqual({
      code: "WORKER_ERROR",
      message: "Node agent-1 failed",
    });
  });

  it("accepts errorJson as a JSON string (an API deploy behind) and decodes it", () => {
    const parsed = contracts.runDetail.parse({
      ...base,
      errorJson: '{"code":"WORKER_ERROR","message":"Node agent-1 failed"}',
    });

    expect(parsed.errorJson).toEqual({
      code: "WORKER_ERROR",
      message: "Node agent-1 failed",
    });
  });

  it("accepts an array output — jsonb is not restricted to objects", () => {
    // A workflow whose last node returns a list stores a JSON array. Requiring
    // an object here failed the response for a run that did nothing wrong.
    const parsed = contracts.runDetail.parse({
      ...base,
      outputJson: [{ city: "Lisbon" }, { city: "Vienna" }],
    });

    expect(parsed.outputJson).toEqual([{ city: "Lisbon" }, { city: "Vienna" }]);
  });

  it("keeps an unparseable value rather than failing the whole response", () => {
    // One malformed column must not take the run detail down with it — that is
    // the failure mode this whole fix is about.
    const parsed = contracts.runDetail.parse({ ...base, errorJson: "not json at all" });

    expect(parsed.errorJson).toBe("not json at all");
  });

  it("normalises an absent column to null", () => {
    // The API omits nulls, so the key is simply missing.
    const parsed = contracts.runDetail.parse(base);

    expect(parsed.errorJson).toBeNull();
    expect(parsed.outputJson).toBeNull();
  });
});
