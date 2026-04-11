import { cn } from "@/lib/utils";

interface BeeLogoProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * VectorBea mark — a stylised bee with abstract wings.
 * Uses currentColor so it can be tinted with text-primary etc.
 */
export function BeeLogo({ className, ...props }: BeeLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-5 w-5", className)}
      aria-hidden="true"
      {...props}
    >
      {/* Wings */}
      <ellipse cx="7.5" cy="8" rx="3.2" ry="2.2" opacity="0.55" />
      <ellipse cx="16.5" cy="8" rx="3.2" ry="2.2" opacity="0.55" />
      {/* Body */}
      <ellipse cx="12" cy="14" rx="4.2" ry="5.2" fill="currentColor" fillOpacity="0.18" />
      {/* Stripes */}
      <path d="M8.4 12.6h7.2" />
      <path d="M8.1 15.2h7.8" />
      <path d="M8.6 17.8h6.8" />
      {/* Antennae */}
      <path d="M10.4 9.2 L9.2 6.4" />
      <path d="M13.6 9.2 L14.8 6.4" />
      {/* Antenna tips */}
      <circle cx="9.2" cy="6.2" r="0.6" fill="currentColor" />
      <circle cx="14.8" cy="6.2" r="0.6" fill="currentColor" />
    </svg>
  );
}
