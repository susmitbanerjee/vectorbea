"use client";

/**
 * ArchitectLogo — the AI Workflow Architect mark.
 * Black tile + node graph with a green checkpoint diamond: the architect
 * literally draws your workflow graph. Matches the LogoCube / control-plane
 * brand language (black #0B0D0F, green #007F4E family).
 */
export function ArchitectLogo({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-[9px]"
      style={{
        width: size,
        height: size,
        background: "#0B0D0F",
        boxShadow: "0 2px 10px rgba(11,13,15,0.28)",
      }}
    >
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24" fill="none">
        {/* Edges: trigger → agent → output, branch down-right */}
        <path
          d="M5 6.5 H11 M13.2 7.6 L17 11 M17 13 L13.2 16.4 M11 17.5 H5"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        {/* Trigger node (top-left) */}
        <rect x="2.6" y="4.5" width="4" height="4" rx="1.3" fill="#FFFFFF" fillOpacity="0.92" />
        {/* Output node (bottom-left) */}
        <rect x="2.6" y="15.5" width="4" height="4" rx="1.3" fill="#FFFFFF" fillOpacity="0.55" />
        {/* Central checkpoint diamond — the durable signature */}
        <rect
          x="14.7" y="9.7" width="4.6" height="4.6" rx="1.1"
          transform="rotate(45 17 12)"
          fill="#00A65A"
        />
        {/* Sparkle: the AI accent */}
        <path
          d="M11.4 10.4 L12 12 L13.6 12.6 L12 13.2 L11.4 14.8 L10.8 13.2 L9.2 12.6 L10.8 12 Z"
          fill="#FFFFFF"
        />
      </svg>
    </div>
  );
}

/** Inline text + logo lockup */
export function ArchitectWordmark({ size = 32 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <ArchitectLogo size={size} />
      <div>
        <p className="text-[14px] font-bold leading-none text-[#0B0D0F]">AI Workflow Architect</p>
        <p className="mt-0.5 text-[11px] leading-none text-[#6B7280]">Describe automation. Vectorbea builds the workflow.</p>
      </div>
    </div>
  );
}
