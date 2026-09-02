"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * One selection, shared by every view, living in the URL.
 *
 * ── WHY THE URL AND NOT REACT STATE ─────────────────────────────────────────
 * Debugging is a conversation. Somebody finds the step that broke and sends it
 * to the person who owns it — and with selection in component state, the link
 * they send opens the tab at the top of an unrelated view, with the recipient
 * asked to find it again from a description. That is where most of the time in a
 * support thread actually goes.
 *
 * In the URL, the link IS the finding. It also survives a reload, back/forward
 * behaves the way people expect, and the run bar's "in the step that failed"
 * segment becomes something you can point at.
 *
 * ── ONE SELECTION, TWO KEYS ─────────────────────────────────────────────────
 * The views disagree about what a selection IS. The Flow view selects a NODE,
 * which is stable across executions; the timeline and inspector select a SPAN,
 * which is one execution of one. Storing only a span id loses the node when a
 * node ran three times; storing only a node id cannot address the third attempt.
 *
 * So both are kept, and each view reads the one it can use. Selecting a node
 * also sets its most recent span so the other views land somewhere real, and
 * selecting a span sets the node it belongs to so the map highlights the card.
 *
 * `replace`, not `push`: clicking through eight nodes while reading a run should
 * not bury the page the reader arrived from under eight history entries.
 */

export const NODE_PARAM = "node";
export const SPAN_PARAM = "span";
export const VIEW_PARAM = "view";

export interface DebugSelection {
  nodeId: string | null;
  spanId: string | null;
  view: string | null;
  /** Select a graph node, and a span within it for the span-addressed views. */
  selectNode: (nodeId: string | null, spanId?: string | null) => void;
  /** Select one execution. `nodeId` is what the map should highlight. */
  selectSpan: (spanId: string | null, nodeId?: string | null) => void;
  setView: (view: string) => void;
}

export function useDebugSelection(): DebugSelection {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const nodeId = params.get(NODE_PARAM);
  const spanId = params.get(SPAN_PARAM);
  const view = params.get(VIEW_PARAM);

  /*
   * Built from the CURRENT params each time rather than from a captured copy:
   * two updates in one tick (select a node, then switch view) must not have the
   * second silently discard the first.
   */
  const write = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      /* `typedRoutes` cannot check a href assembled at runtime, and this one is
         the current pathname with different query — the same page by
         construction. Cast at the boundary rather than weakening the router
         type everywhere else. */
      const href = (qs ? `${pathname}?${qs}` : pathname) as Parameters<typeof router.replace>[0];
      router.replace(href, { scroll: false });
    },
    [params, pathname, router],
  );

  const selectNode = React.useCallback(
    (id: string | null, span?: string | null) =>
      write({ [NODE_PARAM]: id, [SPAN_PARAM]: span ?? null }),
    [write],
  );

  const selectSpan = React.useCallback(
    (id: string | null, node?: string | null) =>
      /* `undefined` means "leave the node alone" — selecting a deeper span
         inside the node the reader already picked must not clear the card
         highlight in the map they will switch back to. */
      write(node === undefined ? { [SPAN_PARAM]: id } : { [SPAN_PARAM]: id, [NODE_PARAM]: node }),
    [write],
  );

  const setView = React.useCallback((v: string) => write({ [VIEW_PARAM]: v }), [write]);

  return { nodeId, spanId, view, selectNode, selectSpan, setView };
}
