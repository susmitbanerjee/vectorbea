import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { USE_CASES, getUseCasePath } from "@/lib/marketing/pages";

// Next renders this with a real HTTP 404 status. Keep it out of the index.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6" style={{ background: "#F7F8F9", color: "#0B0D0F" }}>
      <div className="w-full max-w-[560px] text-center">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]">Error 404</p>
        <h1 className="mt-2 text-[32px] font-bold tracking-[-0.03em] sm:text-[40px]">This page could not be found</h1>
        <p className="mx-auto mt-4 max-w-[42ch] text-[15px] leading-[1.7] text-[#4B5563]">
          The page you&apos;re looking for doesn&apos;t exist or has moved. Try one of these instead:
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="inline-flex items-center gap-2 rounded-[9px] bg-[#0B0D0F] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
            Go to homepage
          </Link>
          <Link href="/docs" className="inline-flex items-center gap-2 rounded-[9px] border bg-white px-5 py-2.5 text-[14px] font-semibold text-[#0B0D0F] transition-colors hover:bg-[#F3F4F5]" style={{ borderColor: "#E0E3E6" }}>
            Read the docs
          </Link>
        </div>

        <nav className="mt-9 border-t pt-6 text-left" style={{ borderColor: "#E0E3E6" }} aria-label="Popular use cases">
          <p className="mb-3 text-center font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Popular use cases</p>
          <ul className="mx-auto grid max-w-[440px] grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {USE_CASES.map((p) => (
              <li key={p.slug}>
                <Link href={getUseCasePath(p.slug) as Route} className="text-[13.5px] text-[#007F4E] hover:underline">
                  {p.navLabel}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
