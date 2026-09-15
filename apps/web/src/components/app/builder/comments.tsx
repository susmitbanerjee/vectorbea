"use client";

import * as React from "react";
import { useStore } from "@xyflow/react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import type { Comment } from "./store";
import type { BuilderNode } from "~/mocks/builder";
import { LocalTime } from "~/components/ui/local-time";

/* ══════════════════════════════════════════════════════════════════════════════
   COMMENT PINS

   Anchored to a NODE or to a canvas position. The difference matters: a comment
   on a node follows it when the graph is re-laid out, and a comment on the
   canvas stays where it was put. "Why is this retry only 1?" belongs to the
   node; "this whole branch needs rethinking" belongs to the region.

   Pins render above the canvas in screen space, transformed with the viewport,
   so they scale with zoom without ever being drawn at an unreadable size — the
   pin shrinks to a dot and the body is behind a click.
══════════════════════════════════════════════════════════════════════════════ */

export function CommentLayer({
  comments, nodes, onResolve,
}: {
  comments: Comment[];
  nodes: BuilderNode[];
  onResolve: (id: string) => void;
}) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const [open, setOpen] = React.useState<string | null>(null);

  const visible = comments.filter((c) => !c.resolved);
  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden={false}>
      {visible.map((comment) => {
        // A node-anchored pin reads its position from the node, so it follows an
        // auto-layout rather than being left behind pointing at empty canvas.
        const anchor = comment.nodeId ? nodes.find((n) => n.node.id === comment.nodeId) : null;
        const cx = anchor ? anchor.x + 200 : comment.x;
        const cy = anchor ? anchor.y : comment.y;
        const left = cx * zoom + tx;
        const top = cy * zoom + ty;
        const isOpen = open === comment.id;

        return (
          <div key={comment.id} className="pointer-events-auto absolute" style={{ left, top }}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : comment.id)}
              aria-label={`Comment by ${comment.author}${anchor ? ` on ${anchor.node.name}` : ""}`}
              aria-expanded={isOpen}
              className={cn(
                "border-status-waiting-border bg-status-waiting-subtle text-status-waiting",
                "grid size-5 place-items-center rounded-full rounded-bl-none border",
                "transition-transform duration-fast hover:scale-110",
                "outline-none focus-visible:focus-ring",
              )}
            >
              <svg viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth={1.4}>
                <path d="M1.4 2h7.2v4.4H4.9L3 8V6.4H1.4z" strokeLinejoin="round" />
              </svg>
            </button>

            {isOpen ? (
              <div
                className={cn(
                  "motion-overlay bg-surface-overlay border-subtle shadow-2 absolute left-6 top-0",
                  "w-56 rounded-md border p-2",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <Text variant="caption" tone="secondary">{comment.author}</Text>
                  <Text variant="caption" tone="disabled" className="tabular">
                    <LocalTime at={comment.at} format="clock" />
                  </Text>
                </div>
                <Text variant="body-sm" tone="primary" className="mt-1 block break-words">
                  {comment.body || <span className="text-fg-disabled">Empty note.</span>}
                </Text>
                {anchor ? (
                  <Text variant="caption" tone="muted" className="mt-1 block truncate">
                    On {anchor.node.name}
                  </Text>
                ) : null}
                <button
                  type="button"
                  onClick={() => { onResolve(comment.id); setOpen(null); }}
                  className={cn(
                    "font-ui text-caption text-fg-muted hover:text-fg-primary mt-2 rounded-xs",
                    "transition-colors duration-fast outline-none focus-visible:focus-ring",
                  )}
                >
                  Resolve
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
