import type { contracts } from "@vectorbea/shared";
import type { Scope, VectorbeaClient } from "~/lib/api/client";
import { toStoredGraph, triggerConfigFrom } from "../graph-codec";
import type { TemplateRefs, WorkflowTemplate } from "./catalog";

/* ══════════════════════════════════════════════════════════════════════════════
   INSTALLING A TEMPLATE.

   ── A TEMPLATE IS NOT A GRAPH, IT IS A GRAPH PLUS ITS PREREQUISITES ─────────
   `AgentNodeExecutor` resolves `config.agentId` as a UUID and fails the node
   outright without one. So a template whose nodes name agents by NAME installs
   cleanly, opens on the canvas looking finished, and fails on its first run with
   "missing required config" — which is exactly the experience a starter template
   exists to prevent. The agents have to exist first, and the graph has to be
   built from their real ids.

   That is the whole shape of this file: create the resources, collect the ids,
   build the graph from them, write the workflow and its first version.

   ── ORDER MATTERS, AND SO DOES WHAT HAPPENS ON FAILURE ──────────────────────
   Agents and tools are created BEFORE the workflow. If an agent creation fails —
   most often the plan's `max_agents` ceiling — nothing has been written that
   references it, and the error names the limit. The reverse order would leave a
   workflow whose nodes point at agents that were never created: a row in the
   list that cannot run and cannot be repaired from the canvas.

   Partial installs are REPORTED, not rolled back. There is no transaction across
   four HTTP calls, and a best-effort cleanup that itself fails leaves a worse
   mess than the one it was cleaning: half-deleted agents that other workflows
   may by then reference. So the failure carries what WAS created, and the caller
   says so.

   ── THE VERSION IS WHAT MAKES IT RUNNABLE ───────────────────────────────────
   `POST /api/workflows/:id/versions` is also what points `current_version_id` at
   the new version, and what materialises a cron schedule from `triggerConfig`.
   A workflow created without one has no current version, and `RunRoutes` refuses
   every trigger with "has no current version — publish a version first".
══════════════════════════════════════════════════════════════════════════════ */

export interface InstallOptions {
  template: WorkflowTemplate;
  /** Name for the new workflow. Defaults to the template's. */
  name?: string;
  /** Where the template's email steps send. May be empty. */
  notifyEmail?: string;
  /** The workspace's connections, already loaded — used to bind and to decide optionals. */
  connections: contracts.Connection[];
  scope: Scope;
}

export interface InstallResult {
  workflowId: string;
  versionId: string;
  agentIds: string[];
  toolIds: string[];
  /** Optional tools the workspace had no connection for. Named, not hidden. */
  skippedTools: { name: string; withoutIt: string }[];
}

export class TemplateInstallError extends Error {
  /** What had already been created when this failed. */
  readonly created: { agentIds: string[]; toolIds: string[]; workflowId: string | null };
  /** The step that failed, for a message that says where rather than what. */
  readonly step: "agents" | "tools" | "workflow" | "version";

  constructor(
    message: string,
    step: InstallError["step"],
    created: InstallError["created"],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "TemplateInstallError";
    this.step = step;
    this.created = created;
  }
}
type InstallError = TemplateInstallError;

/**
 * The connection a template's agents are bound to.
 *
 * ACTIVE ONES FIRST. A workspace often has an expired credential sitting beside
 * a working one, and binding a brand-new template to the broken one produces a
 * first run that fails for a reason that has nothing to do with the template.
 */
export function pickConnection(
  connections: contracts.Connection[],
  kind: string,
): contracts.Connection | null {
  const ofKind = connections.filter((c) => c.type === kind);
  return ofKind.find((c) => c.status === "active") ?? ofKind[0] ?? null;
}

/** Everything the workspace is missing before [template] can be installed. */
export function missingPrerequisites(
  template: WorkflowTemplate,
  connections: contracts.Connection[],
): string[] {
  const missing: string[] = [];
  if (!pickConnection(connections, template.requiresConnection)) {
    missing.push(
      template.requiresConnection === "llm"
        ? "A model connection. Add one under Connections — it is the only thing this template needs."
        : `A ${template.requiresConnection} connection.`,
    );
  }
  return missing;
}

export async function installTemplate(
  api: VectorbeaClient,
  { template, name, notifyEmail = "", connections, scope }: InstallOptions,
): Promise<InstallResult> {
  const created = { agentIds: [] as string[], toolIds: [] as string[], workflowId: null as string | null };

  const connection = pickConnection(connections, template.requiresConnection);
  if (!connection) {
    throw new TemplateInstallError(
      `This template needs a ${template.requiresConnection} connection, and this workspace has none.`,
      "agents",
      created,
    );
  }
  const llmConnectionId = template.requiresConnection === "llm" ? connection.id : null;

  /* ── 1. Optional tools ─────────────────────────────────────────────────────
     Before the agents, because an agent's `allowedToolIds` names them. An
     optional tool whose connection is absent is SKIPPED and reported — not
     created against the wrong connection, and not silently dropped. */
  const tools: Record<string, string> = {};
  const skippedTools: InstallResult["skippedTools"] = [];

  for (const spec of template.optionalTools) {
    const toolConnection = pickConnection(connections, spec.connectionKind);
    if (!toolConnection) {
      skippedTools.push({ name: spec.name, withoutIt: spec.withoutIt });
      continue;
    }
    try {
      const tool = await api.tools.create({
        name: `${spec.name} (${template.name})`,
        type: spec.type,
        riskLevel: spec.riskLevel,
        requiresApproval: spec.requiresApproval,
        connectionId: toolConnection.id,
        config: spec.config,
        status: "active",
      }, scope);
      tools[spec.ref] = tool.id;
      created.toolIds.push(tool.id);
    } catch (error) {
      /* An OPTIONAL tool that fails does not fail the install. It is reported
         the same way an absent connection is, because the outcome for the
         person is identical: the template runs without that step. */
      skippedTools.push({
        name: spec.name,
        withoutIt: `${spec.withoutIt} (It could not be created: ${errorText(error)})`,
      });
    }
  }

  /* ── 2. Agents ───────────────────────────────────────────────────────────── */
  const agents: Record<string, string> = {};
  const grantable = Object.values(tools);

  for (const spec of template.agents) {
    try {
      const agent = await api.agents.create({
        name: `${spec.name} (${template.name})`,
        type: spec.type,
        role: spec.role,
        instructions: spec.instructions,
        llmConnectionId,
        maxIterations: spec.maxIterations,
        // Every agent in a template gets every tool the template created. The
        // templates are small enough that a per-agent grant list would be
        // ceremony; a real workspace narrows these, which is exactly the edit
        // the documentation asks for.
        allowedToolIds: grantable,
        status: "active",
      }, scope);
      agents[spec.ref] = agent.id;
      created.agentIds.push(agent.id);
    } catch (error) {
      throw new TemplateInstallError(
        `The agent “${spec.name}” could not be created: ${errorText(error)}`,
        "agents",
        created,
        { cause: error },
      );
    }
  }

  /* ── 3. The graph, from the real ids ─────────────────────────────────────── */
  const refs: TemplateRefs = { agents, tools, llmConnectionId, notifyEmail };
  const graph = template.build(refs);

  /* ── 4. The workflow row ─────────────────────────────────────────────────── */
  let workflow: contracts.Workflow;
  try {
    workflow = await api.workflows.create({
      name: name?.trim() || template.name,
      description: template.summary,
      status: "draft",
    }, scope);
    created.workflowId = workflow.id;
  } catch (error) {
    throw new TemplateInstallError(
      `The workflow could not be created: ${errorText(error)}`,
      "workflow",
      created,
      { cause: error },
    );
  }

  /* ── 5. The first version — what makes it runnable ───────────────────────── */
  try {
    const version = await api.workflows.createVersion(workflow.id, {
      graph: toStoredGraph(graph),
      // Lifted off the trigger node. Without it the scheduled template has no
      // `schedules` row and its cron never fires.
      triggerConfig: triggerConfigFrom(graph),
      inputSchema: {},
      outputSchema: {},
    }, scope);

    return {
      workflowId: workflow.id,
      versionId: version.id,
      agentIds: created.agentIds,
      toolIds: created.toolIds,
      skippedTools,
    };
  } catch (error) {
    throw new TemplateInstallError(
      `The workflow was created but its first version was not, so it cannot run yet: ${errorText(error)}`,
      "version",
      created,
      { cause: error },
    );
  }
}

/** The API's own sentence, when there is one. */
function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "the API refused the request";
}
