import Link from "next/link";
import { Activity, BarChart3, DollarSign, Gauge } from "lucide-react";

const NAV = [
  { href: "/technical", label: "Infrastructure",   icon: Gauge },
  { href: "/business",  label: "Business & Growth", icon: DollarSign },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* ── Sidebar ── */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-gray-800 bg-gray-900 px-3 py-5">
        {/* Logo */}
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600">
            <Activity className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-white">VectorBea</p>
            <p className="text-[10px] text-gray-500">Telemetry</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto px-2 text-[10px] text-gray-600">
          Internal · Not for distribution
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
