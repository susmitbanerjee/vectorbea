"use client";

import { useEffect, useRef, useState } from "react";

let initialized = false;

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.str === "string") return obj.str;
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

function decodeChart(encodedChart?: string, chart?: string): string {
  if (encodedChart) {
    try {
      if (typeof window !== "undefined" && typeof window.atob === "function") {
        return decodeURIComponent(escape(window.atob(encodedChart)));
      }
      return Buffer.from(encodedChart, "base64").toString("utf-8");
    } catch {
      // fall through
    }
  }
  return chart ?? "";
}

export function Mermaid({ chart, encodedChart }: { chart?: string; encodedChart?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const resolvedChart = decodeChart(encodedChart, chart);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReady(false);

    import("mermaid").then(async (mod) => {
      if (cancelled) return;
      const mermaid = mod.default;

      if (!initialized) {
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
        initialized = true;
      }

      const node = containerRef.current;
      if (!node) return;

      // Reset content to the raw chart source on every run so mermaid.run()
      // can re-process it (it replaces the element's innerHTML with rendered SVG).
      node.removeAttribute("data-processed");
      node.innerHTML = resolvedChart;

      try {
        await mermaid.run({ nodes: [node] });
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error("[mermaid] render failed:", err, JSON.stringify(err));
          setError(describeError(err));
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedChart]);

  if (error) {
    return (
      <div className="my-6 overflow-x-auto rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="mb-2 text-xs font-medium text-amber-800">
          Diagram failed to render: {error}
        </p>
        <pre className="overflow-x-auto text-xs text-slate-500">{resolvedChart}</pre>
      </div>
    );
  }

  return (
    <div className="my-6 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      {!ready && <pre className="text-xs text-slate-400">Rendering diagram…</pre>}
      <div
        ref={containerRef}
        className="mermaid"
        style={{ visibility: ready ? "visible" : "hidden", height: ready ? "auto" : 0 }}
      >
        {resolvedChart}
      </div>
    </div>
  );
}
