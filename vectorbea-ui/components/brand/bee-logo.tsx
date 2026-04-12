import { cn } from "@/lib/utils";

interface BeeLogoProps {
  className?: string;
}

export function BeeLogo({ className }: BeeLogoProps) {
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
    >
      <ellipse cx="7.5" cy="8" rx="3.2" ry="2.2" opacity="0.55" />
      <ellipse cx="16.5" cy="8" rx="3.2" ry="2.2" opacity="0.55" />
      <ellipse
        cx="12"
        cy="14"
        rx="4.2"
        ry="5.2"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path d="M8.4 12.6h7.2" />
      <path d="M8.1 15.2h7.8" />
      <path d="M8.6 17.8h6.8" />
      <path d="M10.4 9.2 L9.2 6.4" />
      <path d="M13.6 9.2 L14.8 6.4" />
      <circle cx="9.2" cy="6.2" r="0.6" fill="currentColor" />
      <circle cx="14.8" cy="6.2" r="0.6" fill="currentColor" />
    </svg>
  );
}
