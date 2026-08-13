"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Input } from "./input";
import { Button, IconButton } from "./button";

/**
 * <KeyValueEditor> — headers, env vars, tool arguments, tags.
 *
 * Rows are keyed by a stable internal id rather than by array index, so editing
 * the first key does not re-mount and blur every row beneath it. Index keys are
 * the standard bug in this pattern and they are invisible until a user is typing
 * fast.
 *
 * Values can be marked secret: the input masks and the value is never echoed
 * back into the DOM as plain text.
 */
export interface KeyValuePair {
  key: string;
  value: string;
  secret?: boolean;
}

export interface KeyValueEditorProps {
  value: KeyValuePair[];
  onValueChange: (value: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
  disabled?: boolean;
  /** Allow marking individual rows as secret. */
  allowSecret?: boolean;
  className?: string;
}

type Row = KeyValuePair & { _id: string };

export function KeyValueEditor({
  value, onValueChange, keyPlaceholder = "Key", valuePlaceholder = "Value",
  addLabel = "Add row", disabled = false, allowSecret = false, className,
}: KeyValueEditorProps) {
  // Stable ids, regenerated only when the row count changes from outside.
  const idRef = React.useRef(0);
  const [rows, setRows] = React.useState<Row[]>(() =>
    value.map((p) => ({ ...p, _id: `kv-${idRef.current++}` })),
  );

  React.useEffect(() => {
    setRows((prev) => {
      if (prev.length === value.length && prev.every((r, i) => r.key === value[i].key && r.value === value[i].value)) {
        return prev;
      }
      return value.map((p, i) => ({ ...p, _id: prev[i]?._id ?? `kv-${idRef.current++}` }));
    });
  }, [value]);

  const push = (next: Row[]) => {
    setRows(next);
    onValueChange(next.map(({ _id, ...p }) => p));
  };

  const update = (id: string, patch: Partial<KeyValuePair>) =>
    push(rows.map((r) => (r._id === id ? { ...r, ...patch } : r)));

  return (
    <div className={cn("grid gap-1.5", className)}>
      {rows.length > 0 ? (
        <div className="grid gap-1.5">
          {rows.map((row) => (
            <div key={row._id} className="flex items-center gap-1.5">
              <Input
                aria-label="Key"
                mono
                size="sm"
                className="flex-1"
                placeholder={keyPlaceholder}
                value={row.key}
                disabled={disabled}
                onChange={(e) => update(row._id, { key: e.target.value })}
              />
              <Input
                aria-label="Value"
                mono
                size="sm"
                className="flex-1"
                type={row.secret ? "password" : "text"}
                placeholder={valuePlaceholder}
                value={row.value}
                disabled={disabled}
                onChange={(e) => update(row._id, { value: e.target.value })}
              />
              {allowSecret ? (
                <IconButton
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  label={row.secret ? "Reveal value" : "Mark as secret"}
                  aria-pressed={row.secret ?? false}
                  onClick={() => update(row._id, { secret: !row.secret })}
                  icon={row.secret ? <LockClosed /> : <LockOpen />}
                />
              ) : null}
              <IconButton
                size="sm"
                variant="ghost"
                disabled={disabled}
                label={`Remove ${row.key || "row"}`}
                onClick={() => push(rows.filter((r) => r._id !== row._id))}
                icon={
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
                    <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor"
                      strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                }
              />
            </div>
          ))}
        </div>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        className="justify-start self-start"
        onClick={() => push([...rows, { key: "", value: "", _id: `kv-${idRef.current++}` }])}
        iconLeft={
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        }
      >
        {addLabel}
      </Button>
    </div>
  );
}

function LockClosed() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function LockOpen() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 4.6-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
