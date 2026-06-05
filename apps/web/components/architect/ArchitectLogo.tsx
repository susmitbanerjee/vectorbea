"use client";

/**
 * ArchitectLogo — refined Vectorbea AI Workflow Architect mark.
 * Geometric node-graph + sparkle, clean vector SVG.
 */
export function ArchitectLogo({ size = 32 }: { size?: number }) {
  return (
    <div
      className="flex items-center justify-center shrink-0 rounded-[10px]"
      style={{
        width: size, height: size,
        background: "linear-gradient(135deg, #6366F1 0%, #2563EB 100%)",
        boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
      }}
    >
      <svg width={size * 0.625} height={size * 0.625} viewBox="0 0 20 20" fill="none">
        {/* Central node */}
        <circle cx="10" cy="10" r="2.5" fill="white" />
        {/* Top-left node */}
        <circle cx="3.5" cy="3.5" r="1.5" fill="rgba(255,255,255,0.75)" />
        {/* Top-right sparkle node */}
        <circle cx="16.5" cy="3.5" r="1.5" fill="rgba(255,255,255,0.75)" />
        {/* Bottom-left node */}
        <circle cx="3.5" cy="16.5" r="1.5" fill="rgba(255,255,255,0.6)" />
        {/* Bottom-right node */}
        <circle cx="16.5" cy="16.5" r="1.5" fill="rgba(255,255,255,0.6)" />
        {/* Connecting edges */}
        <line x1="4.8" y1="4.8" x2="8.2" y2="8.2" stroke="rgba(255,255,255,0.7)" strokeWidth="1.25" strokeLinecap="round" />
        <line x1="15.2" y1="4.8" x2="11.8" y2="8.2" stroke="rgba(255,255,255,0.7)" strokeWidth="1.25" strokeLinecap="round" />
        <line x1="4.8" y1="15.2" x2="8.2" y2="11.8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.25" strokeLinecap="round" />
        <line x1="15.2" y1="15.2" x2="11.8" y2="11.8" stroke="rgba(255,255,255,0.5)" strokeWidth="1.25" strokeLinecap="round" />
        {/* Sparkle top-right accent */}
        <path d="M16.5 1 L17 2.5 L18.5 3 L17 3.5 L16.5 5 L16 3.5 L14.5 3 L16 2.5 Z"
          fill="rgba(255,255,255,0.9)" />
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
        <p className="text-[14px] font-bold text-slate-900 leading-none">AI Workflow Architect</p>
        <p className="text-[11px] text-slate-500 mt-0.5 leading-none">Describe automation. Vectorbea builds the workflow.</p>
      </div>
    </div>
  );
}
