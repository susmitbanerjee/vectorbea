import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const [projectDir, ...args] = process.argv.slice(2);

if (!projectDir || args.length === 0) {
  console.error("Usage: node scripts/run-gradle.mjs <project-dir> <gradle-args...>");
  process.exit(1);
}

const cwd = resolve(projectDir);
const windows = process.platform === "win32";
const command = windows ? "gradlew.bat" : "bash";
const commandArgs = windows ? args : ["./gradlew", ...args];
const result = spawnSync(command, commandArgs, {
  cwd,
  stdio: "inherit",
  shell: windows,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
