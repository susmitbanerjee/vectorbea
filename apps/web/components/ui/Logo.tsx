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
        alt="Vectorbea"
        width={24}
        height={24}
        className="h-[22px] w-[22px] shrink-0 rounded-[6px] object-contain"
        priority
      />
      {showName && (
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          Vectorbea
        </span>
      )}
    </span>
  );
}
