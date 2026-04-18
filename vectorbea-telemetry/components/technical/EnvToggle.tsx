"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Badge } from "@tremor/react";

export function EnvToggle() {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();
  const current     = (searchParams.get("env") ?? "prod") as "dev" | "prod";

  function toggle(env: "dev" | "prod") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("env", env);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/60 p-1">
      {(["prod", "dev"] as const).map((env) => (
        <button
          key={env}
          type="button"
          onClick={() => toggle(env)}
          className={[
            "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
            current === env
              ? "bg-blue-600 text-white shadow"
              : "text-gray-400 hover:text-white",
          ].join(" ")}
        >
          {env === "prod" ? "🟢 Production" : "🔵 Development"}
        </button>
      ))}
    </div>
  );
}
