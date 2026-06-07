"use client";

import { useEffect, useState } from "react";
import type { Heading } from "@/lib/mdx";

export function TableOfContents({ headings }: { headings: Heading[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const elements = headings
      .map((h) => document.getElementById(h.slug))
      .filter((el): el is HTMLElement => Boolean(el));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: "-100px 0px -70% 0px" }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="Table of contents" className="text-sm">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
        On this page
      </p>
      <ul className="space-y-2 border-l border-slate-200">
        {headings.map((h) => (
          <li key={h.slug} style={{ paddingLeft: h.depth === 3 ? "1.5rem" : "1rem" }}>
            <a
              href={`#${h.slug}`}
              className={`block border-l-2 -ml-px pl-3 transition-colors ${
                activeId === h.slug
                  ? "border-accent-blue font-medium text-accent-blue"
                  : "border-transparent text-slate-500 hover:text-ink"
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
