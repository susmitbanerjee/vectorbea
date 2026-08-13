import { WORKFLOWS } from "./src/mocks/fixtures";
import { currentVersion, validateVersion, draftVersion } from "./src/mocks/workflow-versions";
for (const w of WORKFLOWS) {
  const cand = draftVersion(w.id) ?? currentVersion(w.id);
  const f = validateVersion(cand?.nodes ?? []);
  const e = f.filter(x=>x.severity==="error");
  console.log(`${w.name.padEnd(24)} publish-candidate=v${cand?.number} errors=${e.length} warnings=${f.length-e.length} ${e.map(x=>x.title).join(" | ")}`);
}
