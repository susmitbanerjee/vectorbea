"use client";

import * as React from "react";
import { cn } from "~/lib/cn";

/**
 * <Reveal> — entrance-only, fires once.
 *
 * An IntersectionObserver that DISCONNECTS after the first intersection. No
 * parallax, no scroll-jacking, nothing that re-animates when the reader scrolls
 * back up: a section that replays every time it re-enters the viewport turns
 * reading into a slideshow the reader does not control.
 *
 * Content is visible from the start for anyone without JS or with reduced
 * motion — the animation only ever adds, never gates.
 */
export function Reveal({
  children, delay = 0, className, as: Tag = "div",
}: {
  children: React.ReactNode;
  /** Milliseconds. Keep within the 240ms stagger window. */
  delay?: number;
  className?: string;
  as?: React.ElementType;
}) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect(); // once, and only once
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={cn(shown && "animate-[ink-reveal_320ms_var(--ease-entrance)_both]", className)}
      style={shown && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
