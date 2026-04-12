import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { MDXComponents } from "mdx/types";

import { MermaidDiagram } from "@/components/docs/mermaid-diagram";

function Pre({
  children,
  ...props
}: ComponentPropsWithoutRef<"pre"> & { children?: ReactNode }) {
  const child = children as {
    props?: {
      className?: string;
      children?: string;
    };
  };

  const className = child?.props?.className ?? "";
  const code = child?.props?.children;

  if (typeof code === "string" && className.includes("language-mermaid")) {
    return <MermaidDiagram chart={code} />;
  }

  return <pre {...props}>{children}</pre>;
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    pre: Pre,
    ...components,
  };
}
