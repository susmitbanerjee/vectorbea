import { WORKFLOWS } from "./src/mocks/fixtures";
import { versionsFor, diffVersions, summariseDiff, validateVersion, simulateVersion, compareReliability, liveVersion, draftVersion } from "./src/mocks/workflow-versions";

for (const w of WORKFLOWS.slice(0, 4)) {
  const vs = versionsFor(w.id);
  console.log(`\n== ${w.name} v${w.version}${w.draftVersion ? ` (draft v${w.draftVersion})` : ""} steps=${w.stepCount} agents=${w.agentCount} tools=${w.toolCount} sr=${w.successRate30d}% spend=${w.spend30dUsd}`);
  console.log("   conns:", w.connectionNames.join(", "), "| tools:", w.toolNames.slice(0,3).join(", "));
  for (const v of vs) console.log(`   v${v.number} ${v.published ? "pub" : "DRAFT"} ${v.author} runs=${v.runCount} sr=${v.successRate}% :: ${v.changeSummary}`);
  if (vs.length >= 2) {
    const d = diffVersions(vs[1].nodes, vs[0].nodes);
    console.log("   diff:", JSON.stringify({a:d.added.length,r:d.removed.length,m:d.modified.length,u:d.unchanged.length}), "->", summariseDiff(d));
    console.log("   rel:", compareReliability(vs[1], vs[0]).sentence);
  }
  const live = liveVersion(w.id)!;
  const f = validateVersion(live.nodes);
  console.log("   validate:", f.length, f.map(x=>`${x.severity}:${x.id}`).join(" "));
  const s = simulateVersion(live.nodes);
  console.log("   simulate:", s.steps.length, "steps", s.estimatedCostUsd, "usd", Math.round(s.estimatedDurationMs/1000)+"s", "gates:", s.gates.length);
}
