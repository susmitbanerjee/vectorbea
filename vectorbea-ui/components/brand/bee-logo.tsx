import Image from "next/image";

import { cn } from "@/lib/utils";

interface BeeLogoProps {
  className?: string;
  priority?: boolean;
}

export function BeeLogo({ className, priority = false }: BeeLogoProps) {
  return (
    <Image
      src="/favicon.svg"
      alt="VectorBea"
      width={40}
      height={40}
      priority={priority}
      className={cn("h-5 w-5 rounded-full", className)}
    />
  );
}
