import { contracts } from "../../packages/shared/dist/index.js";
const WS = "2e1199af-5beb-475a-9e17-33fce73cad5b";
const base = "http://localhost:8080";

const checks = [
  ["/api/runs?pageSize=5", contracts.runPage, "runPage"],
  ["/api/workflows", contracts.workflowPage, "workflowPage"],
  ["/api/connections", contracts.connectionPage, "connectionPage"],
  ["/api/agents", contracts.agentPage, "agentPage"],
  ["/api/tools", contracts.toolPage, "toolPage"],
  ["/api/control/metrics", contracts.controlMetrics, "controlMetrics"],
  ["/api/workers", contracts.workerList, "workerList"],
  ["/api/failure-incidents", contracts.failureIncidentList, "failureIncidentList"],
];

for (const [path, schema, name] of checks) {
  const res = await fetch(base + path, { headers: { "X-Workspace-Id": WS } });
  const body = await res.json().catch(() => null);
  if (!res.ok) { console.log(`${name.padEnd(22)} HTTP ${res.status}  ${JSON.stringify(body).slice(0,90)}`); continue; }
  const parsed = schema.safeParse(body);
  if (parsed.success) { console.log(`${name.padEnd(22)} ✓ valid`); continue; }
  const fields = new Map();
  for (const i of parsed.error.issues) {
    const f = i.path.filter(p => typeof p === "string").join(".");
    fields.set(f, i.message);
  }
  console.log(`${name.padEnd(22)} ✗ ${fields.size} distinct field(s)`);
  for (const [f, m] of fields) console.log(`   ${f.padEnd(28)} ${m}`);
}
