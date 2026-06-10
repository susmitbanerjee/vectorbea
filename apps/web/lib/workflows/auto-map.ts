/**
 * Auto-map engine — the brain behind the no-JSON mapping experience.
 *
 * Given a node's input fields and the available upstream field sources,
 * it suggests the best upstream output for each input by matching names
 * and types. Powers the per-field "Use this" chips and the one-click
 * "Auto-map all" action so users never write {{ steps... }} by hand.
 */

import type {
  NodeInputField, VisualMapping, VisualMappingField,
  FieldSource, NodeOutputField, FieldType,
} from "@/types/workflow-mapping";
import { checkTypeCompatibility } from "@/types/workflow-mapping";

export interface FieldSuggestion {
  mapping: VisualMappingField;
  sourceLabel: string;
  fieldLabel: string;
  fieldPath: string;
  fieldType: FieldType;
  needsConversion: boolean;
  /** 0–1 confidence */
  score: number;
}

// ─── Tokenisation / similarity ────────────────────────────────────────────────

function tokens(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")   // camelCase → camel Case
    .replace(/[._\-/]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// Common synonyms so "task" matches "goal", "id" matches "identifier", etc.
const SYNONYMS: Record<string, string[]> = {
  id: ["identifier", "key", "uuid"],
  task: ["goal", "instruction", "objective", "prompt"],
  prompt: ["task", "input", "message", "query"],
  message: ["text", "body", "content", "prompt"],
  email: ["mail", "recipient", "to"],
  name: ["title", "label"],
  url: ["link", "endpoint", "uri"],
  amount: ["total", "value", "price", "cost"],
  user: ["customer", "account", "person"],
};

function expand(tok: string[]): Set<string> {
  const out = new Set(tok);
  for (const t of tok) (SYNONYMS[t] ?? []).forEach((s) => out.add(s));
  return out;
}

function nameScore(inputKey: string, inputLabel: string, fieldPath: string, fieldLabel: string): number {
  const lastSeg = (fieldPath.split(".").pop() ?? fieldPath).toLowerCase();
  const a = inputKey.toLowerCase();
  if (a === lastSeg) return 1;
  if (a === fieldPath.toLowerCase()) return 0.97;

  const aTok = expand([...tokens(inputKey), ...tokens(inputLabel)]);
  const bTok = expand([...tokens(fieldPath), ...tokens(fieldLabel)]);
  if (aTok.size === 0 || bTok.size === 0) return 0;

  let overlap = 0;
  for (const t of aTok) if (bTok.has(t)) overlap++;
  let score = overlap / Math.max(aTok.size, bTok.size);

  // substring bonus (e.g. "customerId" vs "id")
  if (lastSeg.includes(a) || a.includes(lastSeg)) score = Math.max(score, 0.62);
  return score;
}

// ─── Flatten output field tree ────────────────────────────────────────────────

function flatten(fields: NodeOutputField[]): NodeOutputField[] {
  const out: NodeOutputField[] = [];
  const walk = (f: NodeOutputField) => {
    out.push(f);
    f.children?.forEach(walk);
  };
  fields.forEach(walk);
  return out;
}

// ─── Suggestion API ───────────────────────────────────────────────────────────

/** Best upstream-output suggestion for a single input field (or null). */
export function suggestForField(field: NodeInputField, sources: FieldSource[]): FieldSuggestion | null {
  let best: FieldSuggestion | null = null;
  let bestScore = 0;

  sources.forEach((src, srcIdx) => {
    // Closer (earlier) sources get a slight preference on ties.
    const proximity = 1 - Math.min(srcIdx, 8) * 0.025;
    for (const of of flatten(src.fields)) {
      const compat = checkTypeCompatibility(of.type, field.type);
      if (compat === "incompatible") continue;

      let score = nameScore(field.key, field.label, of.path, of.label) * proximity;
      if (compat === "needs_conversion") score *= 0.72;
      if (field.type === of.type || field.type === "any" || of.type === "any") score += 0.05;

      if (score > bestScore) {
        bestScore = score;
        best = {
          mapping: {
            type: "field",
            sourceId: src.sourceId,
            path: of.path,
            previewLabel: `${src.label} → ${of.label}`,
            previewValue: of.sampleValue,
          },
          sourceLabel: src.label,
          fieldLabel: of.label,
          fieldPath: of.path,
          fieldType: of.type,
          needsConversion: compat === "needs_conversion",
          score,
        };
      }
    }
  });

  return bestScore >= 0.34 ? best : null;
}

/**
 * Auto-map every (unmapped) input field to its best upstream match,
 * but only for confident matches. Returns a { key: mapping } patch.
 */
export function autoMapAll(
  fields: NodeInputField[],
  sources: FieldSource[],
  opts: { includeMapped?: boolean; minScore?: number } = {},
): Record<string, VisualMapping> {
  const min = opts.minScore ?? 0.45;
  const result: Record<string, VisualMapping> = {};
  for (const f of fields) {
    if (!opts.includeMapped && f.mapping.type !== "unset") continue;
    const s = suggestForField(f, sources);
    if (s && s.score >= min) result[f.key] = s.mapping;
  }
  return result;
}

/** How many input fields could be auto-mapped right now (unmapped + confident). */
export function countAutoMappable(fields: NodeInputField[], sources: FieldSource[]): number {
  return Object.keys(autoMapAll(fields, sources)).length;
}
