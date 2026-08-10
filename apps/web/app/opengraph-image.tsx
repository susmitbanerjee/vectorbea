import { ImageResponse } from "next/og";
import { SITE } from "@/lib/seo";

// Default social/link-preview image for the whole site. Individual routes can
// override by adding their own opengraph-image; otherwise this one is attached
// automatically to every page's OpenGraph + Twitter metadata.

export const alt = "Vectorbea — Durable Agentic AI Workflows";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0B0D0F",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#007F4E",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
              fontWeight: 800,
              color: "#FFFFFF",
            }}
          >
            V
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#FFFFFF", letterSpacing: -0.5 }}>
            {SITE.name}
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "#5EEAD4",
              fontSize: 22,
              fontFamily: "monospace",
            }}
          >
            <div style={{ width: 12, height: 12, transform: "rotate(45deg)", border: "3px solid #007F4E", borderRadius: 2 }} />
            {SITE.tagline}
          </div>
          <div style={{ display: "flex", fontSize: 68, fontWeight: 800, color: "#FFFFFF", lineHeight: 1.05, letterSpacing: -2 }}>
            Durable Agentic
            <br />
            AI Workflows
          </div>
        </div>

        {/* Footer capabilities */}
        <div style={{ display: "flex", gap: 16, color: "#9CA3AF", fontSize: 24 }}>
          Checkpoints · Retries · Human approvals · Observability · Failure recovery
        </div>
      </div>
    ),
    { ...size },
  );
}
