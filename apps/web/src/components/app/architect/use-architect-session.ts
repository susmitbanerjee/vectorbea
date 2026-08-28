"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { describeArchitectFailure, type ArchitectFailure } from "~/lib/architect/errors";
import { normalizeClarifyQuestions } from "~/lib/architect/types";
import type {
  AnimationStep, ArchitectPlan, ArchitectUsage, ClarifyQuestion,
  ConnectionRequirement, CreatedWorkflowResult, ReadinessIssue,
  WorkspaceConnectionOption,
} from "~/lib/architect/types";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ARCHITECT SESSION

   Seven stages, one reducer, one place that talks to the API.

   THE STATE LIVES HERE RATHER THAN IN THE VIEW because the flow is resumable
   and the view is not: a build costs a workspace one of its rationed
   allowances, and somebody who navigates away to create a connection — which
   stage 4 explicitly invites — must come back to the plan they left, not to an
   empty prompt box. What persists is the SESSION ID, not the plan: the server
   holds the plan, and re-reading it on resume is the only way the two cannot
   drift.

   ONE OPERATION RUNS AT A TIME, tracked in `busy` rather than in a boolean per
   call. Every one of these is expensive and several are not idempotent —
   `createWorkflow` takes a per-workspace advisory lock — so overlapping them is
   never something the UI should permit by accident.
══════════════════════════════════════════════════════════════════════════════ */

export type StageId =
  | "describe" | "analyze" | "blueprint" | "connect" | "review" | "build" | "ready";

export const STAGES: { id: StageId; label: string; blurb: string }[] = [
  { id: "describe", label: "Describe", blurb: "What the workflow should do" },
  { id: "analyze", label: "Analyze", blurb: "Reading the description" },
  { id: "blueprint", label: "Blueprint", blurb: "The plan, editable" },
  { id: "connect", label: "Connect", blurb: "Credentials it needs" },
  { id: "review", label: "Review", blurb: "What will be created" },
  { id: "build", label: "Build", blurb: "Creating the resources" },
  { id: "ready", label: "Ready", blurb: "Where it lives" },
];

/** Which operation is in flight. Null when idle. */
export type Busy =
  | null | "starting" | "planning" | "revising" | "approving"
  | "binding" | "testing" | "building" | "resuming";

const STORAGE_KEY = "vectorbea-architect-session";

/**
 * What survives a navigation.
 *
 * Deliberately small. The plan, the requirements and the build steps all come
 * back from `GET /api/architect/sessions/:id`, and persisting a copy of them
 * would mean a stale local plan could outlive a revision made in another tab.
 */
interface Persisted {
  sessionId: string;
  stage: StageId;
  prompt: string;
  answers: Record<string, string>;
}

export interface ArchitectState {
  stage: StageId;
  prompt: string;
  sessionId: string | null;
  questions: ClarifyQuestion[];
  answers: Record<string, string>;
  plan: ArchitectPlan | null;
  requirements: ConnectionRequirement[];
  buildSteps: AnimationStep[];
  created: CreatedWorkflowResult | null;
  readinessIssues: ReadinessIssue[];
  failure: ArchitectFailure | null;
  busy: Busy;
  /** Which requirement id a bind/test is running against, for per-row spinners. */
  busyRequirementId: string | null;
}

const EMPTY: ArchitectState = {
  stage: "describe",
  prompt: "",
  sessionId: null,
  questions: [],
  answers: {},
  plan: null,
  requirements: [],
  buildSteps: [],
  created: null,
  readinessIssues: [],
  failure: null,
  busy: null,
  busyRequirementId: null,
};

/** Server stage name → the stage the rail should show on resume. */
function stageFromServer(currentStage: string | undefined, status: string | undefined): StageId | null {
  if (status === "workflow_created" || currentStage === "complete") return "ready";
  switch (currentStage) {
    case "goal_capture":
    case "clarification":
      return "analyze";
    case "plan_generation":
    case "plan_review":
      return "blueprint";
    case "connection_setup":
      return "connect";
    case "tool_generation":
    case "agent_generation":
    case "workflow_graph_generation":
      return "build";
    default:
      return null;
  }
}

export interface ArchitectSessionApi {
  state: ArchitectState;
  usage: ArchitectUsage | null;
  usageLoading: boolean;
  setPrompt: (value: string) => void;
  setAnswer: (question: string, value: string) => void;
  goToStage: (stage: StageId) => void;
  dismissFailure: () => void;
  reset: () => void;

  start: () => Promise<void>;
  generatePlan: () => Promise<void>;
  revise: (instruction: string) => Promise<void>;
  approve: () => Promise<void>;
  bind: (requirementId: string, connectionId: string) => Promise<void>;
  useSimulation: (requirementId: string) => Promise<void>;
  test: (requirementId: string) => Promise<void>;
  build: () => Promise<void>;
  connectionOptions: (preferredType?: string) => Promise<WorkspaceConnectionOption[]>;
}

export function useArchitectSession(): ArchitectSessionApi {
  const api = useApi();
  const scope = useScope();
  const queryClient = useQueryClient();

  const [state, setState] = React.useState<ArchitectState>(EMPTY);
  const patch = React.useCallback((next: Partial<ArchitectState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const writeScope = React.useMemo(
    () => ({ workspaceId: scope.workspaceId, environmentId: null }),
    [scope.workspaceId],
  );

  const usageQuery = useApiQuery({
    queryKey: ["ws", scope.workspaceId, "architect", "usage"],
    queryFn: () => api.architect.usage({ workspaceId: scope.workspaceId }),
    enabled: Boolean(scope.workspaceId),
    // The allowance is the one number on the page a user makes a decision on,
    // and it changes when a build lands in another tab.
    freshness: "live",
    retry: false,
  });

  /* ── Persistence ──────────────────────────────────────────────────────── */

  const persist = React.useCallback((next: ArchitectState) => {
    try {
      if (!next.sessionId) {
        if (next.prompt.trim() === "") {
          window.localStorage.removeItem(STORAGE_KEY);
          return;
        }
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ sessionId: "", stage: next.stage, prompt: next.prompt, answers: next.answers }),
        );
        return;
      }
      const payload: Persisted = {
        sessionId: next.sessionId,
        stage: next.stage,
        prompt: next.prompt,
        answers: next.answers,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {}
  }, []);

  React.useEffect(() => { persist(state); }, [state, persist]);

  /* ── Resume ───────────────────────────────────────────────────────────── */

  const resumed = React.useRef(false);

  React.useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;

    let saved: Partial<Persisted> | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      saved = raw ? (JSON.parse(raw) as Partial<Persisted>) : null;
    } catch {
      saved = null;
    }
    if (!saved) return;

    // A half-written description with no session is still worth restoring, and
    // costs no request to do it.
    if (!saved.sessionId) {
      patch({ prompt: saved.prompt ?? "", answers: saved.answers ?? {} });
      return;
    }

    const sessionId = saved.sessionId;
    patch({
      sessionId,
      prompt: saved.prompt ?? "",
      answers: saved.answers ?? {},
      stage: saved.stage ?? "analyze",
      busy: "resuming",
    });

    void (async () => {
      try {
        const session = await api.architect.session(sessionId, { workspaceId: scope.workspaceId });
        const requirements = session.connectionRequirements
          ?? (await api.architect.connectionRequirements(sessionId, { workspaceId: scope.workspaceId }))
            .connectionRequirements;

        patch({
          plan: session.plan ?? null,
          questions: normalizeClarifyQuestions(session.clarificationQuestions),
          requirements: requirements ?? [],
          created: session.workflowId
            ? {
                workflowId: session.workflowId,
                workflowVersionId: "",
                workflowName: session.plan?.workflowName ?? "Generated workflow",
                readinessStatus: session.readinessStatus ?? undefined,
              }
            : null,
          stage: stageFromServer(session.currentStage, session.status) ?? saved?.stage ?? "blueprint",
          busy: null,
        });
      } catch {
        // A session that cannot be re-read is a session that is gone — expired,
        // deleted, or from another workspace. Silently dropping back to a fresh
        // prompt is better than an error about state the user never chose.
        try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
        setState({ ...EMPTY, prompt: saved?.prompt ?? "" });
      }
    })();
  }, [api, patch, scope.workspaceId]);

  /* ── Operations ───────────────────────────────────────────────────────── */

  /**
   * One wrapper for every call: sets `busy`, clears the last failure, and turns
   * a throw into a rendered `ArchitectFailure` rather than an unhandled
   * rejection. Returns undefined on failure so callers can bail with `?? return`.
   */
  const run = React.useCallback(
    async <T,>(kind: Exclude<Busy, null>, fn: () => Promise<T>, requirementId?: string): Promise<T | undefined> => {
      patch({ busy: kind, busyRequirementId: requirementId ?? null, failure: null });
      try {
        return await fn();
      } catch (error) {
        patch({ failure: describeArchitectFailure(error) });
        return undefined;
      } finally {
        patch({ busy: null, busyRequirementId: null });
      }
    },
    [patch],
  );

  const generatePlanFor = React.useCallback(
    async (sessionId: string, answers: Record<string, string>) => {
      const result = await run("planning", () =>
        api.architect.generatePlan(sessionId, answers, writeScope),
      );
      if (!result) return;
      patch({
        plan: result.plan,
        requirements: result.connectionRequirements ?? [],
        stage: "blueprint",
      });
    },
    [api, patch, run, writeScope],
  );

  const start = React.useCallback(async () => {
    const goal = state.prompt.trim();
    if (!goal) return;

    const session = await run("starting", () => api.architect.createSession(goal, writeScope));
    if (!session) return;

    const questions = normalizeClarifyQuestions(session.clarificationQuestions);
    patch({ sessionId: session.id, questions, stage: "analyze" });

    // No questions means the description was clear enough to design against —
    // so go straight on rather than showing an empty "answer these" step.
    if (questions.length === 0) {
      await generatePlanFor(session.id, {});
    }
  }, [api, generatePlanFor, patch, run, state.prompt, writeScope]);

  const generatePlan = React.useCallback(async () => {
    if (!state.sessionId) return;
    await generatePlanFor(state.sessionId, state.answers);
  }, [generatePlanFor, state.answers, state.sessionId]);

  const revise = React.useCallback(
    async (instruction: string) => {
      const sessionId = state.sessionId;
      if (!sessionId || !instruction.trim()) return;
      const result = await run("revising", () =>
        api.architect.revisePlan(sessionId, instruction.trim(), writeScope),
      );
      if (!result) return;
      patch({ plan: result.plan, requirements: result.connectionRequirements ?? state.requirements });
    },
    [api, patch, run, state.requirements, state.sessionId, writeScope],
  );

  const approve = React.useCallback(async () => {
    const sessionId = state.sessionId;
    if (!sessionId) return;
    const result = await run("approving", () => api.architect.approvePlan(sessionId, writeScope));
    if (!result) return;
    patch({ requirements: result.connectionRequirements ?? [], stage: "connect" });
  }, [api, patch, run, state.sessionId, writeScope]);

  /** Re-read requirements after any mutation, so status never has to be guessed. */
  const refreshRequirements = React.useCallback(
    async (sessionId: string) => {
      try {
        const result = await api.architect.connectionRequirements(sessionId, writeScope);
        patch({ requirements: result.connectionRequirements ?? [] });
      } catch {
        // Non-fatal: the row keeps its previous status rather than the screen
        // failing over a read that only refines what is already shown.
      }
    },
    [api, patch, writeScope],
  );

  const bind = React.useCallback(
    async (requirementId: string, connectionId: string) => {
      const sessionId = state.sessionId;
      if (!sessionId) return;
      const ok = await run(
        "binding",
        () => api.architect.bindConnection(sessionId, requirementId, connectionId, writeScope),
        requirementId,
      );
      if (ok) await refreshRequirements(sessionId);
    },
    [api, refreshRequirements, run, state.sessionId, writeScope],
  );

  const useSimulation = React.useCallback(
    async (requirementId: string) => {
      const sessionId = state.sessionId;
      if (!sessionId) return;
      const ok = await run(
        "binding",
        () => api.architect.useSimulation(sessionId, requirementId, writeScope),
        requirementId,
      );
      if (ok) await refreshRequirements(sessionId);
    },
    [api, refreshRequirements, run, state.sessionId, writeScope],
  );

  const test = React.useCallback(
    async (requirementId: string) => {
      const sessionId = state.sessionId;
      if (!sessionId) return;
      const ok = await run(
        "testing",
        () => api.architect.testConnection(sessionId, requirementId, writeScope),
        requirementId,
      );
      if (ok) await refreshRequirements(sessionId);
    },
    [api, refreshRequirements, run, state.sessionId, writeScope],
  );

  const build = React.useCallback(async () => {
    const sessionId = state.sessionId;
    if (!sessionId) return;

    patch({ stage: "build", buildSteps: [] });

    // Bindings are already recorded server-side by `bind`, so this map is a
    // belt-and-braces replay rather than the only record of them — which is why
    // an unbound requirement is not an error here.
    const bindings: Record<string, string> = {};
    for (const requirement of state.requirements) {
      if (requirement.boundConnectionId) bindings[requirement.tempConnectionId] = requirement.boundConnectionId;
    }

    const result = await run("building", () =>
      api.architect.createWorkflow(sessionId, bindings, writeScope),
    );

    if (!result) {
      // Stay on Build with the failure panel rather than silently rewinding —
      // the user needs to see which step failed before deciding what to do.
      return;
    }

    patch({
      created: result,
      buildSteps: result.animationSteps ?? [],
      readinessIssues: result.readinessIssues ?? [],
      stage: "ready",
    });

    // The workflow now exists; the list and the allowance are both stale.
    void queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all(scope) });
    void queryClient.invalidateQueries({ queryKey: ["ws", scope.workspaceId, "architect", "usage"] });
  }, [api, patch, queryClient, run, scope, state.requirements, state.sessionId, writeScope]);

  const connectionOptions = React.useCallback(
    async (preferredType?: string) => {
      try {
        const result = await api.architect.connections(preferredType, writeScope);
        return result.connections ?? [];
      } catch {
        return [];
      }
    },
    [api, writeScope],
  );

  /* ── Plain state setters ──────────────────────────────────────────────── */

  const setPrompt = React.useCallback((value: string) => patch({ prompt: value }), [patch]);

  const setAnswer = React.useCallback(
    (question: string, value: string) =>
      setState((current) => ({ ...current, answers: { ...current.answers, [question]: value } })),
    [],
  );

  const goToStage = React.useCallback((stage: StageId) => patch({ stage, failure: null }), [patch]);
  const dismissFailure = React.useCallback(() => patch({ failure: null }), [patch]);

  const reset = React.useCallback(() => {
    setState(EMPTY);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  return {
    state,
    usage: usageQuery.data ?? null,
    usageLoading: usageQuery.isPending && usageQuery.fetchStatus !== "idle",
    setPrompt,
    setAnswer,
    goToStage,
    dismissFailure,
    reset,
    start,
    generatePlan,
    revise,
    approve,
    bind,
    useSimulation,
    test,
    build,
    connectionOptions,
  };
}
