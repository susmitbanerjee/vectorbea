"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        className:
          "!bg-card !text-card-foreground !border-border/60 !shadow-panel backdrop-blur-xl !rounded-xl",
        descriptionClassName: "!text-muted-foreground",
      }}
      gap={8}
      expand
      richColors
    />
  );
}
