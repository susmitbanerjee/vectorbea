"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { controlBase, controlSize, useFieldControl, type ControlSize } from "./field";
import { Spinner } from "./spinner";

/* ── Input ──────────────────────────────────────────────────────────────────
   Text-like input with optional leading/trailing adornments. Adornments are
   positioned absolutely and the input is padded around them, so the text never
   reflows when an adornment appears (e.g. a validation spinner arriving). */

// `prefix` is a global HTML attribute (RDFa) typed as string, so it has to be
// omitted before being redefined as a node.
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  size?: ControlSize;
  /** Icon or text before the value. Non-interactive. */
  prefix?: React.ReactNode;
  /** Icon, unit or action after the value. */
  suffix?: React.ReactNode;
  /** Shows a spinner in the suffix slot — for async validation or lookup. */
  loading?: boolean;
  /** Force monospace + tabular. Use for IDs, keys, numbers and durations. */
  mono?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = "md", prefix, suffix, loading = false, mono = false, disabled, ...props },
  ref,
) {
  const field = useFieldControl();
  const hasPrefix = Boolean(prefix);
  const hasSuffix = Boolean(suffix) || loading;

  /**
   * Adornments are measured, not assumed. A fixed `pl-8` is fine for a 16px
   * icon and badly wrong for a text prefix like "https://", which simply
   * overlaps the value. Observing the real width keeps the text clear of any
   * adornment — icon, unit or word — and re-measures if the content changes.
   */
  const prefixRef = React.useRef<HTMLSpanElement | null>(null);
  const suffixRef = React.useRef<HTMLSpanElement | null>(null);
  const [pad, setPad] = React.useState<{ left?: number; right?: number }>({});

  React.useLayoutEffect(() => {
    const measure = () => {
      setPad({
        left: prefixRef.current ? prefixRef.current.offsetWidth + 14 : undefined,
        right: suffixRef.current ? suffixRef.current.offsetWidth + 14 : undefined,
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    if (prefixRef.current) ro.observe(prefixRef.current);
    if (suffixRef.current) ro.observe(suffixRef.current);
    return () => ro.disconnect();
  }, [prefix, suffix, loading]);

  return (
    <div className="relative flex items-center">
      {hasPrefix ? (
        <span
          ref={prefixRef}
          className="text-fg-muted pointer-events-none absolute left-2.5 flex items-center"
          aria-hidden="true"
        >
          {prefix}
        </span>
      ) : null}

      <input
        ref={ref}
        className={cn(controlBase, controlSize[size], mono && "font-code tabular", className)}
        style={{ paddingLeft: pad.left, paddingRight: pad.right }}
        disabled={disabled ?? field.disabled}
        {...field}
        {...props}
      />

      {hasSuffix ? (
        <span ref={suffixRef} className="text-fg-muted absolute right-2.5 flex items-center">
          {loading ? <Spinner label="Checking" /> : suffix}
        </span>
      ) : null}
    </div>
  );
});

/* ── Textarea ───────────────────────────────────────────────────────────────
   Auto-growing. Height is driven by scrollHeight on every change, clamped
   between minRows and maxRows.

   Note it grows by setting `height`, which design §7 forbids ANIMATING — and it
   is not animated. The resize is instantaneous and layout-driven; the rule bans
   transitioning height, not setting it. */

export interface TextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  minRows?: number;
  maxRows?: number;
  /** Disable auto-grow and use a fixed row count. */
  autoGrow?: boolean;
  mono?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, minRows = 3, maxRows = 12, autoGrow = true, mono = false, disabled, onChange, ...props },
  ref,
) {
  const field = useFieldControl();
  const inner = React.useRef<HTMLTextAreaElement | null>(null);

  React.useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement, []);

  const resize = React.useCallback(() => {
    const el = inner.current;
    if (!el || !autoGrow) return;
    const styles = window.getComputedStyle(el);
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    const vertical = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
      + parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
    // Collapse first, or scrollHeight only ever grows.
    el.style.height = "auto";
    const next = Math.min(
      Math.max(el.scrollHeight, lineHeight * minRows + vertical),
      lineHeight * maxRows + vertical,
    );
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > next ? "auto" : "hidden";
  }, [autoGrow, minRows, maxRows]);

  // Re-measure on mount and whenever the value changes from outside.
  React.useLayoutEffect(resize, [resize, props.value, props.defaultValue]);

  return (
    <textarea
      ref={inner}
      rows={minRows}
      className={cn(
        controlBase,
        "resize-none px-2.5 py-1.5 leading-relaxed",
        mono && "font-code",
        className,
      )}
      disabled={disabled ?? field.disabled}
      onChange={(e) => { onChange?.(e); resize(); }}
      {...field}
      {...props}
    />
  );
});
