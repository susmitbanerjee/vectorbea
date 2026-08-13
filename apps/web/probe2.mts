import { WORKFLOWS } from "./src/mocks/fixtures";
console.log(WORKFLOWS.map(w=>`${w.id}  ${w.name}  sr=${w.successRate30d}`).join("\n"));
