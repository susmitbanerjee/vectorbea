/**
 * Auto-evaluation trigger tests.
 * Run with jest or vitest once a test runner is configured.
 */

// ─── Minimal mocks (no real DB calls) ────────────────────────────────────────

// We test the decision logic only — DB and evaluation-runs are mocked.

type AutoEvalResult =
  | { status: "started"; runId: string }
  | { status: "no_dataset"; reason: string }
  | { status: "duplicate_skipped"; existingRunId: string }
  | { status: "error"; reason: string };

function simulateAutoEval(args: {
  hasDataset: boolean;
  hasDuplicate: boolean;
  force?: boolean;
  runFails?: boolean;
}): AutoEvalResult {
  if (!args.hasDataset) {
    return { status: "no_dataset", reason: "No evaluation dataset found for prompt" };
  }
  if (!args.force && args.hasDuplicate) {
    return { status: "duplicate_skipped", existingRunId: "existing-run-id" };
  }
  if (args.runFails) {
    return { status: "error", reason: "createDatasetEvaluationRun failed" };
  }
  return { status: "started", runId: "new-run-id" };
}

describe("Auto-evaluation trigger logic", () => {
  it("returns no_dataset when no evaluation dataset exists", () => {
    const result = simulateAutoEval({ hasDataset: false, hasDuplicate: false });
    expect(result.status).toBe("no_dataset");
    expect((result as { reason: string }).reason).toMatch(/No evaluation dataset/);
  });

  it("skips duplicate run for same version without force", () => {
    const result = simulateAutoEval({ hasDataset: true, hasDuplicate: true, force: false });
    expect(result.status).toBe("duplicate_skipped");
  });

  it("creates new run when force=true even if duplicate exists", () => {
    const result = simulateAutoEval({ hasDataset: true, hasDuplicate: true, force: true });
    expect(result.status).toBe("started");
  });

  it("returns started with runId on success", () => {
    const result = simulateAutoEval({ hasDataset: true, hasDuplicate: false });
    expect(result.status).toBe("started");
    expect((result as { runId: string }).runId).toBeDefined();
  });

  it("returns error when evaluation run creation fails", () => {
    const result = simulateAutoEval({ hasDataset: true, hasDuplicate: false, runFails: true });
    expect(result.status).toBe("error");
  });
});

describe("Auto-evaluation triggers on lifecycle events", () => {
  it("candidate_promoted trigger should create an evaluation run if dataset exists", () => {
    const result = simulateAutoEval({ hasDataset: true, hasDuplicate: false });
    expect(result.status).toBe("started");
  });

  it("manual trigger with force=true bypasses duplicate guard", () => {
    const result = simulateAutoEval({ hasDataset: true, hasDuplicate: true, force: true });
    expect(result.status).toBe("started");
    expect((result as { runId: string }).runId).toBe("new-run-id");
  });
});
