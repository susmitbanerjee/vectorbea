import http from "node:http";
import { cpus, freemem, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type AgentCommand = {
  id?: string;
  command_type?: string;
  type?: string;
  payload?: unknown;
  status?: string;
  created_at?: string;
};

type HeartbeatResponse = {
  acknowledged?: boolean;
  pendingCommands?: AgentCommand[];
  commands?: AgentCommand[];
};

type AgentMetrics = {
  cpuUsagePercent: number;
  memoryUsageMb: number;
  memoryTotalMb: number;
  activeReplicas: number;
  status: "online" | "degraded";
};

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const SHARED_CONFIG_DIR = process.env.VECTORBEA_SHARED_CONFIG_DIR || "/app/shared-config";
const RULES_OUTPUT_PATH =
  process.env.VECTORBEA_RULES_PATH || path.join(SHARED_CONFIG_DIR, "rules.json");
const CONFIG_OUTPUT_PATH =
  process.env.VECTORBEA_CONFIG_PATH || path.join(SHARED_CONFIG_DIR, "config.json");
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const TARGET_CONTAINER_NAME =
  process.env.VECTORBEA_TARGET_CONTAINER_NAME || "vectorbea-core";

const apiUrl = requireEnv("VECTORBEA_API_URL");
const agentToken = requireEnv("VECTORBEA_AGENT_TOKEN");
const pollIntervalMs = parsePollInterval(process.env.POLL_INTERVAL_MS);

let previousCpuSnapshot = takeCpuSnapshot();
let pollInFlight = false;
const handledCommands = new Set<string>();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePollInterval(value: string | undefined): number {
  if (!value) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1_000) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  return parsed;
}

function round(value: number, fractionDigits = 2): number {
  return Number(value.toFixed(fractionDigits));
}

function takeCpuSnapshot() {
  return cpus().map((cpu) => {
    const idle = cpu.times.idle;
    const total = Object.values(cpu.times).reduce((sum, time) => sum + time, 0);
    return { idle, total };
  });
}

function calculateCpuUsagePercent() {
  const currentSnapshot = takeCpuSnapshot();

  const usagePercentages = currentSnapshot.map((current, index) => {
    const previous = previousCpuSnapshot[index];
    const idleDelta = current.idle - previous.idle;
    const totalDelta = current.total - previous.total;

    if (totalDelta <= 0) {
      return 0;
    }

    return (1 - idleDelta / totalDelta) * 100;
  });

  previousCpuSnapshot = currentSnapshot;

  if (usagePercentages.length === 0) {
    return 0;
  }

  const average =
    usagePercentages.reduce((sum, usage) => sum + usage, 0) / usagePercentages.length;

  return round(Math.max(0, Math.min(average, 100)));
}

async function countActiveVectorbeaContainers(): Promise<number> {
  return new Promise<number>((resolve) => {
    const request = http.request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        path: "/containers/json?all=false",
        method: "GET",
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            if (response.statusCode !== 200) {
              resolve(0);
              return;
            }

            const containers = JSON.parse(body) as Array<{
              Names?: string[];
              State?: string;
              Status?: string;
            }>;

            const active = containers.filter((container) => {
              const names = container.Names ?? [];
              const matchesTarget = names.some((name) => name.includes(TARGET_CONTAINER_NAME));
              const state = (container.State || "").toLowerCase();
              const status = (container.Status || "").toLowerCase();
              return matchesTarget && (state === "running" || status.includes("up"));
            });

            resolve(active.length);
          } catch {
            resolve(0);
          }
        });
      },
    );

    request.on("error", () => resolve(0));
    request.end();
  });
}

async function collectMetrics(): Promise<AgentMetrics> {
  const totalMemoryMb = round(totalmem() / (1024 * 1024));
  const usedMemoryMb = round((totalmem() - freemem()) / (1024 * 1024));
  const cpuUsagePercent = calculateCpuUsagePercent();
  const activeReplicas = await countActiveVectorbeaContainers();

  return {
    cpuUsagePercent,
    memoryUsageMb: usedMemoryMb,
    memoryTotalMb: totalMemoryMb,
    activeReplicas,
    status: activeReplicas === 0 ? "degraded" : "online",
  };
}

async function processCommand(command: AgentCommand) {
  const commandId = command.id;
  if (commandId && handledCommands.has(commandId)) {
    return;
  }

  const commandType = command.command_type || command.type || "UNKNOWN";

  if (commandType === "SYNC_RULES") {
    const targetDir = path.dirname(RULES_OUTPUT_PATH);
    await mkdir(targetDir, { recursive: true });
    await writeFile(RULES_OUTPUT_PATH, JSON.stringify(command.payload ?? {}, null, 2), "utf8");
    console.log(`[agent] wrote synced rules to ${RULES_OUTPUT_PATH}`);
  } else if (commandType === "UPDATE_CONFIG") {
    const targetDir = path.dirname(CONFIG_OUTPUT_PATH);
    await mkdir(targetDir, { recursive: true });
    await writeFile(CONFIG_OUTPUT_PATH, JSON.stringify(command.payload ?? {}, null, 2), "utf8");
    console.log(`[agent] wrote config update to ${CONFIG_OUTPUT_PATH}`);
  } else {
    console.log(`[agent] received unsupported command type: ${commandType}`);
  }

  if (commandId) {
    handledCommands.add(commandId);
  }
}

async function processCommands(commands: AgentCommand[]) {
  for (const command of commands) {
    try {
      await processCommand(command);
    } catch (error) {
      console.error("[agent] failed to process command", command.id ?? "<unknown>", error);
    }
  }
}

async function sendHeartbeat() {
  const metrics = await collectMetrics();
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/agents/heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metrics,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Heartbeat failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as HeartbeatResponse;
  const commands = payload.pendingCommands ?? payload.commands ?? [];
  if (commands.length > 0) {
    await processCommands(commands);
  }

  console.log(
    `[agent] heartbeat ok cpu=${metrics.cpuUsagePercent}% memory=${metrics.memoryUsageMb}/${metrics.memoryTotalMb}MB replicas=${metrics.activeReplicas} commands=${commands.length}`,
  );
}

async function pollOnce() {
  if (pollInFlight) {
    console.warn("[agent] previous poll still running, skipping this interval");
    return;
  }

  pollInFlight = true;
  try {
    await sendHeartbeat();
  } catch (error) {
    console.error("[agent] heartbeat error", error);
  } finally {
    pollInFlight = false;
  }
}

async function main() {
  console.log(
    `[agent] starting outbound agent pollIntervalMs=${pollIntervalMs} apiUrl=${apiUrl}`,
  );

  await pollOnce();
  setInterval(() => {
    void pollOnce();
  }, pollIntervalMs);
}

void main().catch((error) => {
  console.error("[agent] fatal startup error", error);
  process.exit(1);
});
