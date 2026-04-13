import Image from "next/image";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** Show the wordmark next to the icon. Defaults to false. */
  showName?: boolean;
}

export function Logo({ className, showName = false }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src="/favicon.svg"
        alt="VectorBea"
        width={24}
        height={24}
        className="h-5 w-5 shrink-0 object-contain"
        priority
      />
      {showName && (
        <span className="text-sm font-semibold tracking-tight text-foreground">
          VectorBea
        </span>
      )}
    </span>
  );
}
