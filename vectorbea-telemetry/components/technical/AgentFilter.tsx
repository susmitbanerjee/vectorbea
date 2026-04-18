"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { AgentStatusFilter } from "@/lib/queries/technical";

const OPTIONS: { value: AgentStatusFilter; label: string; dot: string }[] = [
  { value: "all",     label: "All Agents",  dot: "bg-gray-500"   },
  { value: "online",  label: "Online",      dot: "bg-emerald-400" },
  { value: "offline", label: "Offline",     dot: "bg-rose-400"    },
];

export function AgentFilter() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const current      = (searchParams.get("agentStatus") ?? "all") as AgentStatusFilter;

  function select(value: AgentStatusFilter) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("agentStatus");
    } else {
      params.set("agentStatus", value);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/60 p-1">
      {OPTIONS.map(({ value, label, dot }) => (
        <button
          key={value}
          type="button"
          onClick={() => select(value)}
          className={[
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
            current === value
              ? "bg-gray-700 text-white shadow"
              : "text-gray-400 hover:text-white",
          ].join(" ")}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </button>
      ))}
    </div>
  );
}
