/** Vectorbea logo cube — shared across marketing/SEO pages. */
export function LogoCube({ size = 26 }: { size?: number }) {
  return (
    <span className="flex items-center justify-center rounded-[8px]" style={{ width: size, height: size, background: "#0B0D0F" }}>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <g stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="11.6" cy="11.4" rx="3" ry="2.1" fill="#00A65A" fillOpacity="0.9" />
          <ellipse cx="20.4" cy="11.4" rx="3" ry="2.1" fill="#00A65A" fillOpacity="0.9" />
          <ellipse cx="16" cy="18" rx="4" ry="5" fill="#007F4E" />
          <path d="M12.4 16.4h7.2" />
          <path d="M12.2 19h7.6" />
          <path d="M12.8 21.6h6.4" />
        </g>
      </svg>
    </span>
  );
}

/** Checkpoint diamond — recurring brand motif. */
export function Checkpoint({ size = 9 }: { size?: number }) {
  return (
    <span
      className="inline-block rotate-45 rounded-[2px]"
      style={{ width: size, height: size, background: "#FFFFFF", border: "2px solid #007F4E" }}
      aria-hidden="true"
    />
  );
}
