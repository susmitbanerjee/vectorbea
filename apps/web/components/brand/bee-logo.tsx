import Image from "next/image";

import { cn } from "@/lib/utils";

interface BeeLogoProps {
  className?: string;
}

export function BeeLogo({ className }: BeeLogoProps) {
  return (
    <Image
      src="/favicon.svg"
      alt="VectorBea"
      width={24}
      height={24}
      className={cn("h-5 w-5 object-contain", className)}
      priority
    />
  );
}
