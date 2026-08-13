"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";

/* ══════════════════════════════════════════════════════════════════════════════
   <CodeBlock>

   Hand-rolled highlighting rather than Shiki or Prism. Two reasons that matter
   here: both ship their own colour themes that would have to be fought back onto
   our tokens, and Shiki's grammars are ~1MB before a single line renders. Docs
   pages are the most-linked, least-interactive surface in the product — they
   should not carry a syntax engine.

   The tokeniser below covers the four languages the docs actually use. It is a
   highlighter, not a parser: it never needs to be correct about structure, only
   about which run of characters gets which colour.
══════════════════════════════════════════════════════════════════════════════ */

export type Language = "typescript" | "python" | "bash" | "json";

type Kind = "keyword" | "string" | "comment" | "number" | "fn" | "punct" | "plain";

const KEYWORDS: Record<Language, string[]> = {
  typescript: [
    "import", "from", "export", "const", "let", "var", "function", "return", "await",
    "async", "if", "else", "for", "while", "try", "catch", "finally", "throw", "new",
    "class", "extends", "interface", "type", "as", "of", "in", "typeof", "null",
    "undefined", "true", "false", "default",
  ],
  python: [
    "import", "from", "def", "return", "await", "async", "if", "elif", "else", "for",
    "while", "try", "except", "finally", "raise", "class", "with", "as", "in", "not",
    "is", "None", "True", "False", "lambda", "pass",
  ],
  bash: ["curl", "export", "echo", "cat", "cd", "npm", "npx", "if", "then", "fi", "for", "do", "done"],
  json: ["true", "false", "null"],
};

function tokenise(source: string, language: Language): { text: string; kind: Kind }[] {
  const keywords = new Set(KEYWORDS[language]);
  const out: { text: string; kind: Kind }[] = [];

  // Order matters: comments and strings must win over everything inside them.
  const pattern = new RegExp(
    [
      language === "python" || language === "bash" ? "(#[^\\n]*)" : "(//[^\\n]*|/\\*[\\s\\S]*?\\*/)",
      "(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)",
      "(\\b\\d+(?:\\.\\d+)?\\b)",
      "([A-Za-z_$][\\w$]*)(?=\\s*\\()",
      "([A-Za-z_$][\\w$]*)",
      "([{}()\\[\\],;:.<>=+\\-*/!?&|]+)",
    ].join("|"),
    "g",
  );

  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    if (m.index > last) out.push({ text: source.slice(last, m.index), kind: "plain" });
    if (m[1]) out.push({ text: m[1], kind: "comment" });
    else if (m[2]) out.push({ text: m[2], kind: "string" });
    else if (m[3]) out.push({ text: m[3], kind: "number" });
    else if (m[4]) out.push({ text: m[4], kind: keywords.has(m[4]) ? "keyword" : "fn" });
    else if (m[5]) out.push({ text: m[5], kind: keywords.has(m[5]) ? "keyword" : "plain" });
    else if (m[6]) out.push({ text: m[6], kind: "punct" });
    last = pattern.lastIndex;
  }
  if (last < source.length) out.push({ text: source.slice(last), kind: "plain" });
  return out;
}

/* Token colours are semantic tokens. Keywords take the brand because they are
   the structure the reader scans for; strings take success, numbers live. */
const KIND_CLASS: Record<Kind, string> = {
  keyword: "text-accent",
  string: "text-status-success",
  comment: "text-fg-disabled italic",
  number: "text-status-live",
  fn: "text-fg-max",
  punct: "text-fg-muted",
  plain: "text-fg-secondary",
};

export interface CodeSample {
  language: Language;
  label: string;
  filename?: string;
  code: string;
  /** 1-indexed lines to emphasise. */
  highlight?: number[];
}

export interface CodeBlockProps {
  samples: CodeSample[];
  /** Show the run affordance. Only meaningful for request samples. */
  runnable?: boolean;
  showLineNumbers?: boolean;
}

export function CodeBlock({ samples, runnable = false, showLineNumbers = true }: CodeBlockProps) {
  const [active, setActive] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const [ran, setRan] = React.useState<null | "running" | "done">(null);

  const sample = samples[active];
  const lines = React.useMemo(() => sample.code.replace(/\n$/, "").split("\n"), [sample.code]);
  const highlight = new Set(sample.highlight ?? []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sample.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — the code is selectable, which is the fallback.
    }
  };

  return (
    <figure className="border-subtle bg-surface-sunken my-5 overflow-hidden rounded-md border">
      {(samples.length > 1 || sample.filename) ? (
        <div className="border-subtle flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
          {samples.length > 1 ? (
            <div role="tablist" aria-label="Language" className="flex gap-0.5">
              {samples.map((s, i) => (
                <button
                  key={s.label}
                  role="tab"
                  aria-selected={i === active}
                  onClick={() => setActive(i)}
                  className={cn(
                    "font-ui text-caption rounded-xs px-2 py-1",
                    "transition-colors duration-instant outline-none focus-visible:focus-ring",
                    i === active
                      ? "bg-surface-active text-fg-primary"
                      : "text-fg-muted hover:text-fg-primary",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}

          {sample.filename ? (
            <span className="font-code text-mono-sm text-fg-muted px-1.5">{sample.filename}</span>
          ) : null}

          {/* Copy and Run are dead controls on paper. */}
          <div className="ml-auto flex items-center gap-1 print:hidden">
            {runnable ? (
              <button
                onClick={() => { setRan("running"); setTimeout(() => setRan("done"), 900); }}
                className={cn(
                  "font-ui text-caption rounded-xs px-2 py-1",
                  "text-fg-muted hover:text-fg-primary transition-colors duration-instant",
                  "outline-none focus-visible:focus-ring",
                )}
              >
                {ran === "running" ? "Running…" : ran === "done" ? "200 OK" : "Run this"}
              </button>
            ) : null}
            <button
              onClick={copy}
              aria-label="Copy code"
              className={cn(
                "font-ui text-caption rounded-xs px-2 py-1",
                "text-fg-muted hover:text-fg-primary transition-colors duration-instant",
                "outline-none focus-visible:focus-ring",
              )}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <pre className="font-code text-mono p-3 leading-relaxed">
          <code>
            {lines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "grid",
                  showLineNumbers ? "grid-cols-[2.5rem_1fr]" : "grid-cols-1",
                  // A highlighted line gets a brand tint and a rail, so it reads
                  // as "look here" without a colour that means something else.
                  highlight.has(i + 1) && "bg-accent-subtle -mx-3 px-3",
                )}
              >
                {showLineNumbers ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "font-code tabular select-none pr-3 text-right",
                      highlight.has(i + 1) ? "text-accent" : "text-fg-disabled",
                    )}
                  >
                    {i + 1}
                  </span>
                ) : null}
                <span className="whitespace-pre">
                  {tokenise(line, sample.language).map((t, j) => (
                    <span key={j} className={KIND_CLASS[t.kind]}>{t.text}</span>
                  ))}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>

      {ran === "done" && runnable ? (
        <div className="border-subtle bg-surface-base border-t px-3 py-2">
          <Text variant="caption" tone="muted" className="block">
            Sample response — this is a documentation preview, not a live call against your workspace.
          </Text>
        </div>
      ) : null}
    </figure>
  );
}
