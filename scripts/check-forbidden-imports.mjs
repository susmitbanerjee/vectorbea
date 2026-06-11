#!/usr/bin/env node
/**
 * check-forbidden-imports.mjs
 *
 * Enforces the architecture boundary: Next.js UI components and the
 * repository layer must never import backend-only modules.
 *
 * Forbidden in:  apps/web  (excluding apps/web/app/api/** and apps/web/server/**)
 * Patterns that must NOT appear in frontend/repository code:
 *
 *   @/server/db            — Prisma DB client
 *   @/lib/generated/prisma — Generated Prisma types (server-only)
 *   server/db              — Direct relative import of DB client
 *   getSecretForRuntime    — Secret decryption (server-only)
 *   secret-service         — Secret service module
 *   executeWorkflow        — Workflow execution engine
 *   workflow-executor      — Workflow executor module
 *   ioredis                — Redis client
 *   bullmq                 — Redis job queue client
 *   @/server/services      — Server service layer
 *
 * Usage:
 *   node scripts/check-forbidden-imports.mjs
 *   node scripts/check-forbidden-imports.mjs --fix   (dry-run: lists violations only)
 *
 * Exit 0 if clean, exit 1 if violations found.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, extname } from "path";

const ROOT = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..");
const WEB_ROOT = join(ROOT, "apps", "web");

// Directories to scan (relative to WEB_ROOT)
const SCAN_DIRS = [
  "app",       // page components, layouts, non-API routes
  "components",
  "lib",
  "hooks",
  "context",
  "providers",
];

// Directories that ARE allowed to import backend modules
const ALLOWED_PREFIXES = [
  join(WEB_ROOT, "app", "api"),               // Next.js API routes
  join(WEB_ROOT, "server"),                   // server-only services
  join(WEB_ROOT, "lib", "server"),            // server-only lib modules
  join(WEB_ROOT, "lib", "workflow-runtime"),  // execution engine
  join(WEB_ROOT, "lib", "dal"),               // data-access layer (server-only)
  join(WEB_ROOT, "lib", "generated"),         // auto-generated Prisma client (read-only artefact)
];

// Specific server-only files outside the above directories that are still allowed.
// These are "shim" files: they exist at the lib/ root but must never be imported
// by UI components — they re-export server-only modules for use by API routes.
// TODO Phase 5: move these into lib/server/ and remove this list.
const ALLOWED_FILES = new Set([
  join(WEB_ROOT, "lib", "prisma.ts"),           // Prisma client singleton shim
  join(WEB_ROOT, "lib", "supabase-admin.ts"),   // Supabase admin client (server-only)
  join(WEB_ROOT, "lib", "lemonsqueezy.ts"),     // LemonSqueezy server-side client
]);

// File extensions to check
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs"]);

// Forbidden import patterns (regex applied to each line)
const FORBIDDEN = [
  { pattern: /@\/server\/db\b/,            label: "DB client (@/server/db)" },
  { pattern: /from ["']@\/server\/db\b/,   label: "DB client (@/server/db)" },
  { pattern: /@\/lib\/generated\/prisma/,  label: "Generated Prisma types (@/lib/generated/prisma)" },
  { pattern: /from ["']@\/server\/services/, label: "Server services (@/server/services)" },
  { pattern: /getSecretForRuntime/,         label: "Secret runtime accessor (getSecretForRuntime)" },
  { pattern: /secret-service/,              label: "Secret service module (secret-service)" },
  { pattern: /executeWorkflow/,             label: "Workflow executor (executeWorkflow)" },
  { pattern: /workflow-executor/,           label: "Workflow executor module (workflow-executor)" },
  { pattern: /from ["']ioredis["']/,        label: "Redis client (ioredis)" },
  { pattern: /require\(["']ioredis["']\)/,  label: "Redis client (ioredis)" },
  { pattern: /from ["']bullmq["']/,         label: "BullMQ queue client (bullmq)" },
  { pattern: /require\(["']bullmq["']\)/,   label: "BullMQ queue client (bullmq)" },
];

// ─── Walk directories ─────────────────────────────────────────────────────────

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "__pycache__") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (EXTENSIONS.has(extname(entry))) {
      yield full;
    }
  }
}

function isAllowed(filePath) {
  return ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix))
    || ALLOWED_FILES.has(filePath);
}

// ─── Scan ─────────────────────────────────────────────────────────────────────

const violations = [];

for (const scanDir of SCAN_DIRS) {
  const dir = join(WEB_ROOT, scanDir);
  for (const file of walk(dir)) {
    if (isAllowed(file)) continue;

    let lines;
    try { lines = readFileSync(file, "utf-8").split("\n"); } catch { continue; }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment lines
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;

      for (const { pattern, label } of FORBIDDEN) {
        if (pattern.test(line)) {
          violations.push({
            file: relative(ROOT, file),
            line: i + 1,
            content: line.trim(),
            label,
          });
        }
      }
    }
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

if (violations.length === 0) {
  console.log("✓ No forbidden imports found in frontend code.");
  process.exit(0);
}

console.error(`\n✗ Found ${violations.length} forbidden import(s) in frontend code:\n`);

const byFile = {};
for (const v of violations) {
  (byFile[v.file] ??= []).push(v);
}

for (const [file, vs] of Object.entries(byFile)) {
  console.error(`  ${file}`);
  for (const v of vs) {
    console.error(`    line ${v.line}: [${v.label}]`);
    console.error(`    > ${v.content}`);
  }
  console.error("");
}

console.error(
  "These modules must only be used in apps/web/app/api/**, apps/web/server/**, or apps/web/lib/server/**.\n" +
  "Frontend code must call the backend through apps/web/lib/api/client.ts instead.\n"
);

process.exit(1);
