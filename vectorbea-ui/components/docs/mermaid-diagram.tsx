"use client";

import { useEffect, useId, useState } from "react";

type MermaidModule = typeof import("mermaid");

export function MermaidDiagram({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderChart() {
      try {
        const mermaid = (await import("mermaid")).default as MermaidModule["default"];
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#123EAB",
            primaryTextColor: "#0f172a",
            primaryBorderColor: "#12D6C5",
            lineColor: "#0f172a",
            tertiaryColor: "#dbeafe",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          },
          flowchart: {
            curve: "basis",
          },
          securityLevel: "loose",
        });
        const { svg: rendered } = await mermaid.render(
          `vectorbea-mermaid-${id}`,
          chart,
        );
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (renderError) {
        if (!cancelled) {
          setError(
            renderError instanceof Error
              ? renderError.message
              : "Failed to render Mermaid diagram.",
          );
        }
      }
    }

    void renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className="mt-8 rounded-3xl border border-red-500/20 bg-red-500/10 px-5 py-4 text-sm text-red-300">
        Mermaid failed to render: {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="mt-8 rounded-3xl border border-border/60 bg-card/60 px-5 py-10 text-center text-sm text-muted-foreground">
        Rendering architecture diagram...
      </div>
    );
  }

  return (
    <div className="mermaid-shell mt-8 overflow-hidden rounded-[2rem] border border-border/60 bg-white p-6 shadow-[0_25px_80px_-40px_rgba(18,62,171,0.45)]">
      <div
        className="mermaid-svg overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
