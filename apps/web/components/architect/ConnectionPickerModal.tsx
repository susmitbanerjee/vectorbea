"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Link2, Loader2, Mail, Search, X, Zap } from "lucide-react";
import { listWorkspaceConnections, bindExistingConnection, setSimulationPlaceholder, type ConnectionRequirement } from "@/lib/architect";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface WorkspaceConnection {
  id: string;
  name: string;
  type: string;
  provider: string;
  status: string;
  testStatus?: string;
  typeMatches?: boolean;
}

interface Props {
  sessionId: string;
  requirement: ConnectionRequirement;
  onBound: (reqId: string, connId: string) => void;
  onClose: () => void;
}

const BUILTIN_TYPES = ["email", "smtp", "resend", "sendgrid", "mailgun"];
const isBuiltinEligible = (type: string) =>
  BUILTIN_TYPES.some(t => type.toLowerCase().includes(t));

const isLLMType = (s: string) =>
  /llm|openai|anthropic|claude|gemini|qwen|\bai\b/.test(s.toLowerCase());

export function ConnectionPickerModal({ sessionId, requirement, onBound, onClose }: Props) {
  const [connections, setConnections] = useState<WorkspaceConnection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState("");
  const [binding, setBinding]         = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const canUseBuiltIn = isBuiltinEligible(requirement.type);

  useEffect(() => {
    listWorkspaceConnections()
      .then(r => {
        const sorted = [...r.connections].sort((a, b) => {
          if (a.typeMatches && !b.typeMatches) return -1;
          if (!a.typeMatches && b.typeMatches) return 1;
          return (a.name ?? "").localeCompare(b.name ?? "");
        });
        setConnections(sorted);
      })
      .catch(() => setConnections([]))
      .finally(() => setLoading(false));
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const q = search.toLowerCase();
  const filtered = connections.filter(c =>
    !search ||
    (c.name ?? "").toLowerCase().includes(q) ||
    (c.provider ?? "").toLowerCase().includes(q) ||
    (c.type ?? "").toLowerCase().includes(q)
  );

  async function handleSelect(connId: string) {
    setBinding(true);
    try {
      await bindExistingConnection(sessionId, requirement.id, connId);
      const name = connections.find(c => c.id === connId)?.name ?? connId;
      onBound(requirement.id, connId);
      toast.success(`Connected: ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to bind");
    } finally { setBinding(false); }
  }

  async function handleBuiltIn() {
    setBinding(true);
    try {
      await setSimulationPlaceholder(sessionId, requirement.id);
      onBound(requirement.id, "builtin");
      toast.success("Using built-in email (Resend)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBinding(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#0B0D0F]/30 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md overflow-hidden rounded-[14px] border border-[#E0E3E6] bg-white shadow-[0_24px_60px_rgba(11,13,15,0.18)]">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#ECEEEF] bg-[#FAFBFB] px-4 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#9CCFBB] bg-[#E6F4EF] text-[#007F4E]">
                <Link2 className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div>
                <p className="text-[13px] font-bold text-[#0B0D0F]">{requirement.name}</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#9CA3AF]">
                  {requirement.type} · select a workspace connection
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-[7px] p-1.5 transition-colors hover:bg-[#F3F4F5]">
              <X className="h-4 w-4 text-[#9CA3AF]" />
            </button>
          </div>

          {/* Built-in option */}
          {canUseBuiltIn && (
            <div className="px-3 pt-3">
              <button
                type="button"
                onClick={handleBuiltIn}
                disabled={binding}
                className="flex w-full items-center gap-3 rounded-[10px] border border-[#9CCFBB] bg-[#E6F4EF] px-3 py-2.5 text-left transition-colors hover:bg-[#D9EEE4] disabled:opacity-50"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[#007F4E]">
                  <Mail className="h-3.5 w-3.5 text-white" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-bold text-[#006B45]">Use built-in email (Resend)</span>
                  <span className="block text-[11px] text-[#0F766E]">No connection needed — uses your RESEND_API_KEY</span>
                </span>
                {binding
                  ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#007F4E]" />
                  : <Zap className="h-3.5 w-3.5 shrink-0 text-[#007F4E]" />}
              </button>
              <div className="mb-1 mt-3 flex items-center gap-2">
                <div className="h-px flex-1 bg-[#ECEEEF]" />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#9CA3AF]">or use existing</span>
                <div className="h-px flex-1 bg-[#ECEEEF]" />
              </div>
            </div>
          )}

          {/* Search */}
          <div className="px-3 pb-1 pt-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                autoFocus={!canUseBuiltIn}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search connections…"
                className="w-full rounded-[9px] border border-[#E0E3E6] bg-[#FAFBFB] py-2 pl-9 pr-4 text-[12.5px] text-[#0B0D0F] placeholder:text-[#9CA3AF] focus:border-[#9CCFBB] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15"
              />
            </div>
          </div>

          {/* List */}
          <div className="max-h-56 overflow-y-auto px-3 pb-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[#9CA3AF]">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[12.5px]">Loading connections…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="space-y-2 py-8 text-center">
                <Link2 className="mx-auto h-7 w-7 text-[#E0E3E6]" />
                <p className="text-[12.5px] text-[#9CA3AF]">
                  {connections.length === 0 ? "No connections in workspace yet." : "No results."}
                </p>
                <a
                  href="/connections/new"
                  target="_blank"
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#007F4E] hover:text-[#006B45]"
                >
                  + Create connection <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : (
              <div className="mt-1 space-y-0.5">
                {filtered.map(conn => (
                  <button
                    key={conn.id}
                    type="button"
                    onClick={() => handleSelect(conn.id)}
                    disabled={binding}
                    className="group flex w-full items-center gap-3 rounded-[10px] border border-transparent px-3 py-2.5 text-left transition-colors hover:border-[#9CCFBB] hover:bg-[#E6F4EF]/40 disabled:opacity-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-[#E0E3E6] bg-white text-[#0B0D0F]">
                      {isLLMType(`${conn.provider} ${conn.type}`)
                        ? <ProviderIcon providerType={conn.provider || conn.type} className="h-3.5 w-3.5" />
                        : <Link2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold text-[#0B0D0F]">{conn.name}</span>
                        {conn.typeMatches && (
                          <span className="shrink-0 rounded-full border border-[#9CCFBB] bg-[#E6F4EF] px-1.5 py-px font-mono text-[8.5px] font-semibold uppercase tracking-[0.08em] text-[#006B45]">
                            Suggested
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[10.5px] text-[#9CA3AF]">{conn.provider || conn.type}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {(conn.testStatus === "connected" || conn.testStatus === "passed") && (
                        <Check className="h-3.5 w-3.5 text-[#007F4E]" strokeWidth={2.5} />
                      )}
                      <span className={cn(
                        "rounded-[7px] border border-[#9CCFBB] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#006B45]",
                        "opacity-0 transition-opacity group-hover:opacity-100",
                      )}>
                        Select
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-4 py-3">
            <button type="button" onClick={onClose} className="text-[12px] font-medium text-[#6B7280] transition-colors hover:text-[#0B0D0F]">
              Cancel
            </button>
            <a
              href="/connections/new"
              target="_blank"
              className="inline-flex items-center gap-1 rounded-[8px] border border-[#E0E3E6] bg-white px-3 py-1.5 text-[12px] font-medium text-[#4B5563] transition-colors hover:bg-[#F7F8F9]"
            >
              + New connection <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
