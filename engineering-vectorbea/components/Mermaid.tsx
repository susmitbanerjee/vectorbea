"use client";

import { useEffect, useRef, useState } from "react";

let initialized = false;

export function Mermaid({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
      node.innerHTML = chart;

      try {
        await mermaid.run({ nodes: [node] });
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error("[mermaid] render failed:", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="my-6 overflow-x-auto rounded-xl border border-amber-300 bg-amber-50 p-4">
        <p className="mb-2 text-xs font-medium text-amber-800">
          Diagram failed to render: {error}
        </p>
        <pre className="overflow-x-auto text-xs text-slate-500">{chart}</pre>
      </div>
    );
  }

  return (
    <div className="my-6 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      {!ready && <pre className="text-xs text-slate-400">Rendering diagram…</pre>}
      <div
        ref={containerRef}
        className="mermaid"
        style={{ display: ready ? "block" : "none" }}
      >
        {chart}
      </div>
    </div>
  );
}
