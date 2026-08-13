"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Button } from "./button";

/* ══════════════════════════════════════════════════════════════════════════════
   <CodeEditor> — JSON, with highlighting, validation and format-on-blur.

   Deliberately NOT a full editor dependency. CodeMirror and Monaco are 200 KB+
   and bring their own theming, focus and scroll behaviour that would have to be
   fought back into line with our tokens. What the product actually needs — tool
   arguments, node config, a webhook payload — is a textarea that colours JSON
   and refuses to let you save something malformed.

   The technique is a highlighted <pre> layered exactly beneath a transparent
   <textarea>: the textarea keeps every native behaviour (caret, selection, IME,
   undo, spellcheck-off, screen-reader support) and the <pre> supplies colour.
   Both share identical font metrics and padding, which is what keeps the caret
   registered with the painted glyphs.
══════════════════════════════════════════════════════════════════════════════ */

type Token = { text: string; kind: "key" | "string" | "number" | "literal" | "punct" };

/**
 * Minimal JSON tokeniser. Not a parser — it never needs to build a tree, only to
 * decide the colour of each run. Falls back to plain text on anything it does
 * not recognise, so invalid JSON still renders while you are mid-keystroke.
 */
function tokenise(src: string): Token[] {
  const out: Token[] = [];
  const re = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ text: src.slice(last, m.index), kind: "punct" });
    if (m[1]) out.push({ text: m[1], kind: "key" });
    else if (m[2]) out.push({ text: m[2], kind: "string" });
    else if (m[3]) out.push({ text: m[3], kind: "number" });
    else if (m[4]) out.push({ text: m[4], kind: "literal" });
    else out.push({ text: m[5], kind: "punct" });
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ text: src.slice(last), kind: "punct" });
  return out;
}

/* Token colours are semantic tokens, never raw hues. Keys take the brand because
   they are the structure the operator scans for; values take foreground steps. */
const TOKEN_CLASS: Record<Token["kind"], string> = {
  key: "text-accent",
  string: "text-status-success",
  number: "text-status-live",
  literal: "text-status-waiting",
  punct: "text-fg-muted",
};

export interface CodeEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Reformat with 2-space indent when focus leaves, if the JSON parses. */
  formatOnBlur?: boolean;
  placeholder?: string;
  disabled?: boolean;
  minRows?: number;
  className?: string;
  /** Called whenever validity changes, so a form can gate its submit. */
  onValidChange?: (valid: boolean) => void;
  "aria-label"?: string;
}

export function CodeEditor({
  value, onValueChange, formatOnBlur = true, placeholder, disabled = false,
  minRows = 8, className, onValidChange, ...aria
}: CodeEditorProps) {
  const [error, setError] = React.useState<string | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const preRef = React.useRef<HTMLPreElement | null>(null);

  const validate = React.useCallback(
    (src: string): string | null => {
      if (src.trim() === "") return null;
      try { JSON.parse(src); return null; }
      catch (e) { return e instanceof Error ? e.message.replace(/^JSON\.parse: /, "") : "Invalid JSON"; }
    },
    [],
  );

  React.useEffect(() => {
    const next = validate(value);
    setError(next);
    onValidChange?.(next === null);
  }, [value, validate, onValidChange]);

  // The painted layer must scroll in lockstep with the editable one.
  const syncScroll = () => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const format = () => {
    if (value.trim() === "") return;
    try { onValueChange(JSON.stringify(JSON.parse(value), null, 2)); }
    catch { /* leave malformed input exactly as typed — reformatting would lose it */ }
  };

  const tokens = React.useMemo(() => tokenise(value), [value]);
  const shared = "font-code text-mono leading-relaxed p-3 whitespace-pre-wrap break-words";

  return (
    <div className={cn("grid gap-1.5", className)}>
      <div
        className={cn(
          "relative rounded-sm border transition-colors duration-fast",
          "bg-surface-sunken",
          error ? "border-status-failed" : "border-default",
          "focus-within:focus-ring",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <pre ref={preRef} aria-hidden="true" className={cn(shared, "pointer-events-none m-0 overflow-hidden")}>
          {tokens.map((t, i) => (
            <span key={i} className={TOKEN_CLASS[t.kind]}>{t.text}</span>
          ))}
          {/* Trailing newline keeps the last line painted while typing. */}
          {"\n"}
        </pre>

        <textarea
          ref={taRef}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          rows={minRows}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onScroll={syncScroll}
          onChange={(e) => onValueChange(e.target.value)}
          onBlur={() => { if (formatOnBlur) format(); }}
          onKeyDown={(e) => {
            // Tab inserts two spaces rather than leaving the field — but only
            // with no modifier, so Shift+Tab still escapes for keyboard users.
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: s, selectionEnd: t } = el;
              const next = `${value.slice(0, s)}  ${value.slice(t)}`;
              onValueChange(next);
              requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
            }
          }}
          className={cn(
            shared,
            "absolute inset-0 size-full resize-none overflow-auto bg-transparent",
            "text-transparent caret-fg-max outline-none",
            "placeholder:text-fg-muted",
          )}
          {...aria}
        />
      </div>

      <div className="flex items-start justify-between gap-3">
        {error ? (
          <p role="alert" className="font-ui text-caption text-status-failed">
            {error}
          </p>
        ) : (
          <p className="font-ui text-caption text-fg-muted">JSON · Tab indents · formats on blur</p>
        )}
        <Button size="xs" variant="ghost" onClick={format} disabled={disabled || Boolean(error)}>
          Format
        </Button>
      </div>
    </div>
  );
}
