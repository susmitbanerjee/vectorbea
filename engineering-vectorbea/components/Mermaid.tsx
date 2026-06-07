"use client";

import { useEffect, useId, useRef, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = `mermaid-diagram-${rawId || Math.random().toString(36).slice(2)}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);

    import("mermaid")
      .then(async (mod) => {
        const mermaid = mod.default;
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
        try {
          const { svg: renderedSvg } = await mermaid.render(id, chart);
          if (!cancelled) setSvg(renderedSvg);
        } catch (err) {
          if (!cancelled) {
            // eslint-disable-next-line no-console
            console.error("[mermaid] render failed:", err);
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error("[mermaid] failed to load module:", err);
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (svg) {
    return (
      <div
        ref={ref}
        className="my-6 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

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
    <div
      ref={ref}
      className="my-6 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4"
    >
      <pre className="text-xs text-slate-400">Rendering diagram…</pre>
    </div>
  );
}
