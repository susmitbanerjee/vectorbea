"use client";

import { useEffect, useId, useRef, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[:]/g, "");
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({ startOnLoad: false, theme: "neutral" });
      mermaid
        .render(`mermaid-${id}`, chart)
        .then(({ svg }) => {
          if (!cancelled) setSvg(svg);
        })
        .catch(() => {
          if (!cancelled) setSvg(null);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  return (
    <div
      ref={ref}
      className="my-6 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4"
      {...(svg ? { dangerouslySetInnerHTML: { __html: svg } } : {})}
    >
      {!svg && <pre className="text-xs text-slate-400">Rendering diagram…</pre>}
    </div>
  );
}
