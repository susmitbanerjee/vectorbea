import Link from "next/link";

export function TagPill({ tag, href }: { tag: string; href?: string }) {
  const className =
    "inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:border-accent-blue hover:text-accent-blue transition-colors";
  if (href) {
    return (
      <Link href={href} className={className}>
        {tag}
      </Link>
    );
  }
  return <span className={className}>{tag}</span>;
}
