import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { Callout } from "./Callout";
import { Mermaid } from "./Mermaid";

function Pre(props: ComponentPropsWithoutRef<"pre">) {
  const child = props.children as { props?: { className?: string; children?: ReactNode } } | undefined;
  const className = child?.props?.className ?? "";

  if (className.includes("language-mermaid")) {
    const raw = child?.props?.children;
    const chart = Array.isArray(raw) ? raw.join("") : String(raw ?? "");
    return <Mermaid chart={chart} />;
  }

  return <pre {...props} />;
}

function A(props: ComponentPropsWithoutRef<"a">) {
  const { href = "", ...rest } = props;
  if (href.startsWith("/")) {
    return <Link href={href} {...rest} />;
  }
  return <a href={href} target="_blank" rel="noopener noreferrer" {...rest} />;
}

export const MDXComponents = {
  Callout,
  pre: Pre,
  a: A,
};
