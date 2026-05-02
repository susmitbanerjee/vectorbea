"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { useRBAC, useWorkspace } from "@/lib/workspace-context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IngestToken {
  id: string;
  name: string;
  tokenPrefix: string;
  lastFour: string;
  maskedToken: string;
  scopes: string[];
  environment: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
}

interface TokenWithRaw extends IngestToken {
  rawToken: string;
}

type IngestTokenListResponse = {
  items: IngestToken[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}
function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toast({ message, type, onDismiss }: { message: string; type: "success" | "error"; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg text-sm font-medium animate-in slide-in-from-bottom-4
      ${type === "success" ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]" : "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]"}`}>
      {type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
      {message}
      <button type="button" onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100"><XCircle className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-xl border border-[#E7DED1] bg-[#1C1917] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#2D2A26]">
        <span className="text-[10px] font-mono text-[#78716C] uppercase tracking-wider">{lang}</span>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}
          className="flex items-center gap-1.5 text-[11px] text-[#78716C] hover:text-white transition-colors">
          {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-[#4ADE80]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 text-[12px] leading-relaxed text-[#E7E5E4] font-mono whitespace-pre"><code>{code}</code></pre>
    </div>
  );
}

function Section({ title, icon: Icon, badge, defaultOpen = true, children }: {
  title: string; icon: React.ElementType; badge?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="border-[#E7DED1] bg-white">
      <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-[#EFF6FF] p-1.5"><Icon className="h-4 w-4 text-[#2563EB]" /></div>
          <CardTitle className="text-sm text-[#111111] flex-1">{title}</CardTitle>
          {badge && <Badge className="bg-[#F3F4F6] text-[#374151] text-[10px]">{badge}</Badge>}
          {open ? <ChevronDown className="h-4 w-4 text-[#9CA3AF]" /> : <ChevronRight className="h-4 w-4 text-[#9CA3AF]" />}
        </div>
      </CardHeader>
      {open && <CardContent className="space-y-4 text-sm text-[#374151]">{children}</CardContent>}
    </Card>
  );
}

// ─── Reveal card (shown once after create/rotate) ─────────────────────────────

function RawTokenReveal({ rawToken, onDismiss }: { rawToken: string; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border-2 border-[#2563EB] bg-[#EFF6FF] p-4 space-y-3">
      <div className="flex items-start gap-2">
        <BadgeCheck className="h-5 w-5 text-[#2563EB] shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-[#1E3A8A] text-sm">Token created — copy it now</p>
          <p className="text-xs text-[#3B82F6] mt-0.5">This is the only time you will see the raw token. It cannot be retrieved later.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-[#BFDBFE] bg-white px-3 py-2 font-mono text-xs">
        <span className="flex-1 break-all select-all">{visible ? rawToken : rawToken.slice(0, 10) + "•".repeat(20) + rawToken.slice(-4)}</span>
        <button type="button" onClick={() => setVisible((v) => !v)} className="text-[#93C5FD] hover:text-[#2563EB]">
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={() => { void navigator.clipboard.writeText(rawToken).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}
          className="flex items-center gap-1 text-xs text-[#3B82F6] hover:text-[#2563EB] font-medium">
          {copied ? <><CheckCircle2 className="h-3.5 w-3.5" />Copied</> : <><Copy className="h-3.5 w-3.5" />Copy</>}
        </button>
      </div>
      <button type="button" onClick={onDismiss} className="w-full rounded-xl border border-[#BFDBFE] px-4 py-2 text-xs font-semibold text-[#1D4ED8] hover:bg-[#DBEAFE]">
        I&apos;ve copied my token — dismiss
      </button>
    </div>
  );
}

// ─── Create token dialog ──────────────────────────────────────────────────────

function CreateTokenDialog({ open, workspaceId, onClose, onCreated }: {
  open: boolean; workspaceId: string; onClose: () => void; onCreated: (t: TokenWithRaw) => void;
}) {
  const [name, setName] = useState("");
  const [env, setEnv] = useState("production");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/settings/ingest-tokens?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), environment: env || null, expiresAt: expiry || null }),
      });
      const json = (await res.json()) as TokenWithRaw & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to create token");
      onCreated(json);
      setName(""); setEnv("production"); setExpiry("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to create token"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md border-[#E7DED1] bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Create ingest token</DialogTitle>
          <DialogDescription className="text-[#6B7280]">Used by SDKs, sidecars, and proxies to send traces.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Token name *</label>
            <input className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111] focus:border-[#2563EB] focus:outline-none"
              placeholder="e.g. production-refund-agent" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Environment</label>
            <Select value={env} onChange={(e) => setEnv(e.target.value)}>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
              <option value="test">Test</option>
            </Select>
          </div>
          <div>
            <label className="block mb-1 text-xs font-semibold text-[#374151]">Expires at (optional)</label>
            <input type="datetime-local" className="w-full rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 text-[#111111] focus:border-[#2563EB] focus:outline-none"
              value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-xl border border-[#E7DED1] px-4 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]">Cancel</button>
            <button type="button" disabled={!name.trim() || saving} onClick={() => void handleCreate()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Create token
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rotate confirm dialog ────────────────────────────────────────────────────

function RotateDialog({ token, workspaceId, onClose, onRotated }: {
  token: IngestToken | null; workspaceId: string; onClose: () => void; onRotated: (t: TokenWithRaw) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRotate() {
    if (!token) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/settings/ingest-tokens/${encodeURIComponent(token.id)}/rotate?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST" });
      const json = (await res.json()) as TokenWithRaw & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to rotate token");
      onRotated(json);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to rotate"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={!!token} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md border-[#E7DED1] bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Rotate token</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Rotating <span className="font-semibold text-[#111111]">{token?.name}</span> will immediately invalidate the current token value. Any services still using the old value will start failing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-xs text-[#92400E]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          Update all services that use this token before rotating, or be ready to update them immediately after.
        </div>
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#E7DED1] px-4 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void handleRotate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#D97706] px-4 py-2 text-sm font-semibold text-white hover:bg-[#B45309] disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Rotate token
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Revoke confirm dialog ────────────────────────────────────────────────────

function RevokeDialog({ token, workspaceId, onClose, onRevoked }: {
  token: IngestToken | null; workspaceId: string; onClose: () => void; onRevoked: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke() {
    if (!token) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/settings/ingest-tokens/${encodeURIComponent(token.id)}/revoke?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to revoke token");
      onRevoked(token.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to revoke"); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={!!token} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md border-[#E7DED1] bg-white">
        <DialogHeader>
          <DialogTitle className="text-[#111111]">Revoke token</DialogTitle>
          <DialogDescription className="text-[#6B7280]">
            Revoking <span className="font-semibold text-[#111111]">{token?.name}</span> will permanently disable it. Revoked tokens cannot be reactivated.
          </DialogDescription>
        </DialogHeader>
        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs text-[#991B1B]">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#E7DED1] px-4 py-2 text-sm text-[#374151] hover:bg-[#F8F5EF]">Cancel</button>
          <button type="button" disabled={saving} onClick={() => void handleRevoke()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white hover:bg-[#B91C1C] disabled:opacity-50">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Revoke permanently
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Token status badge ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IngestToken["status"] }) {
  if (status === "active") return <Badge className="bg-[#ECFDF5] text-[#065F46] text-[10px]">Active</Badge>;
  if (status === "expired") return <Badge className="bg-[#FFFBEB] text-[#92400E] text-[10px]">Expired</Badge>;
  return <Badge className="bg-[#FEF2F2] text-[#991B1B] text-[10px]">Revoked</Badge>;
}

// ─── Token table row ──────────────────────────────────────────────────────────

function TokenRow({ token, onRotate, onRevoke, canManage }: {
  token: IngestToken;
  onRotate: (t: IngestToken) => void;
  onRevoke: (t: IngestToken) => void;
  canManage: boolean;
}) {
  const [showMasked, setShowMasked] = useState(false);
  const isActive = token.status === "active";
  return (
    <tr className="border-b border-[#F1ECE3] hover:bg-[#FBFAF7]">
      <td className="py-3 pr-4 text-sm font-medium text-[#111111]">{token.name}</td>
      <td className="py-3 pr-4">
        {token.environment
          ? <Badge className="bg-[#F3F4F6] text-[#374151] text-[10px]">{token.environment}</Badge>
          : <span className="text-[#9CA3AF] text-xs">—</span>}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-1.5 font-mono text-xs text-[#374151]">
          {showMasked ? token.maskedToken : `${token.tokenPrefix.slice(0, 10)}••••`}
          <button type="button" onClick={() => setShowMasked((v) => !v)} className="text-[#9CA3AF] hover:text-[#2563EB]">
            {showMasked ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        </div>
      </td>
      <td className="py-3 pr-4 text-xs text-[#6B7280]">{fmtRelative(token.lastUsedAt)}</td>
      <td className="py-3 pr-4 text-xs text-[#6B7280]">{fmtDate(token.createdAt)}</td>
      <td className="py-3 pr-4 text-xs text-[#6B7280]">
        {token.expiresAt ? fmtDate(token.expiresAt) : <span className="text-[#9CA3AF]">Never</span>}
      </td>
      <td className="py-3 pr-4"><StatusBadge status={token.status} /></td>
      <td className="py-3">
        <div className="flex items-center gap-1">
          {canManage && isActive && (
            <button type="button" onClick={() => onRotate(token)} title="Rotate token"
              className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#FFF7ED] hover:text-[#D97706]">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {canManage && isActive && (
            <button type="button" onClick={() => onRevoke(token)} title="Revoke token"
              className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#DC2626]">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {!canManage && <span className="text-[11px] text-[#9CA3AF]">Admin only</span>}
        </div>
      </td>
    </tr>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SdkPage() {
  const { activeWorkspaceId } = useWorkspace();
  const { isAdmin } = useRBAC();
  const ingestUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/ingest/traces`
    : "https://app.vectorbea.com/api/ingest/traces";

  const [tokens, setTokens] = useState<IngestToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [rotateTarget, setRotateTarget] = useState<IngestToken | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<IngestToken | null>(null);
  const [revealToken, setRevealToken] = useState<TokenWithRaw | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (!isAdmin) {
      setTokens([]);
      setTokenError(null);
      setLoadingTokens(false);
      return;
    }
    setLoadingTokens(true);
    fetch(`/api/settings/ingest-tokens?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: IngestTokenListResponse | { error?: string }) => {
        if (Array.isArray((j as IngestTokenListResponse).items)) setTokens((j as IngestTokenListResponse).items);
        else setTokenError((j as { error?: string }).error ?? "Failed to load tokens");
      })
      .catch((e: Error) => setTokenError(e.message))
      .finally(() => setLoadingTokens(false));
  }, [activeWorkspaceId, isAdmin]);

  function handleCreated(t: TokenWithRaw) {
    const { rawToken: _rawToken, ...token } = t;
    setTokens((prev) => [token, ...prev]);
    setRevealToken(t);
    showToast("Token created");
  }

  function handleRotated(t: TokenWithRaw) {
    const { rawToken: _rawToken, ...token } = t;
    setTokens((prev) => prev.map((tok) => (tok.id === token.id ? token : tok)));
    setRotateTarget(null);
    setRevealToken(t);
    showToast("Token rotated — copy the new value now");
  }

  function handleRevoked(id: string) {
    setTokens((prev) => prev.map((t) => t.id === id ? { ...t, status: "revoked" as const, revokedAt: new Date().toISOString() } : t));
    setRevokeTarget(null);
    showToast("Token revoked");
  }

  const activeTokens = tokens.filter((t) => t.status === "active");
  const inactiveTokens = tokens.filter((t) => t.status !== "active");

  return (
    <div className="min-h-screen bg-[#F8F5EF]">
      <AppHeader title="SDK &amp; Ingest" subtitle="Connect your AI agents, tools, and MCP workflows to VectorBea" />
      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8 max-w-5xl">

        {/* Quick-start callout */}
        <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-5 py-4 flex gap-4 items-start">
          <Zap className="h-5 w-5 text-[#2563EB] shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-[#1E3A8A] text-sm mb-1">Four integration modes</p>
            <ol className="list-decimal list-inside space-y-1 text-xs text-[#1E40AF]">
              <li><span className="font-medium">SDK instrumentation</span> — wrap agent calls in Python/TypeScript</li>
              <li><span className="font-medium">Proxy / sidecar</span> — route LLM traffic through VectorBea&apos;s proxy; tool calls via SDK</li>
              <li><span className="font-medium">OpenTelemetry spans</span> — map OTEL spans to VectorBea&apos;s schema and POST to ingest</li>
            </ol>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/sdk-and-ingestion"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8]"
              >
                Read SDK and Ingestion docs
              </Link>
              <span className="text-[11px] text-[#3B82F6]">
                Current ingest tokens use the vb_li_ prefix for compatibility
              </span>
              <Link
                href="/docs/operations-and-migrations"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-medium text-[#1D4ED8] hover:text-[#1E3A8A]"
              >
                View migration notes
              </Link>
              <Link
                href="/onboarding/workflow-discovery"
                className="text-[11px] font-medium text-[#1D4ED8] hover:text-[#1E3A8A]"
              >
                Open workflow discovery wizard
              </Link>
            </div>
          </div>
        </div>

        {/* ── Token management ─────────────────────────────────────────────── */}
        <Section title="Ingest tokens" icon={KeyRound}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[#6B7280]">
              Tokens authenticate your SDK, sidecar, or proxy when sending traces.
              Scoped to <code className="bg-[#F3F4F6] px-1 rounded">traces:write</code>.
              Never expose tokens in frontend code. Raw tokens are shown only once after create or rotate.
            </p>
            {activeWorkspaceId && isAdmin && (
              <button type="button" onClick={() => setShowCreate(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-[#2563EB] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8]">
                <Plus className="h-3.5 w-3.5" />New token
              </button>
            )}
          </div>
          {!isAdmin && (
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-4 py-3 text-xs text-[#6B7280]">
              Only workspace admins can create, rotate, or revoke ingest tokens.
            </div>
          )}

          {/* Reveal card — shown once after create/rotate */}
          {revealToken && (
            <RawTokenReveal rawToken={revealToken.rawToken} onDismiss={() => setRevealToken(null)} />
          )}

          {/* Token table */}
          {loadingTokens && (
            <div className="flex items-center gap-2 text-sm text-[#6B7280]">
              <Loader2 className="h-4 w-4 animate-spin" />Loading tokens…
            </div>
          )}
          {tokenError && (
            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{tokenError}</div>
          )}
          {!loadingTokens && !tokenError && tokens.length === 0 && (
            <div className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-4 py-8 text-center">
              <KeyRound className="h-8 w-8 text-[#D8CFC2] mx-auto mb-2" />
              <p className="text-sm font-medium text-[#374151]">No ingest tokens yet</p>
              <p className="text-xs text-[#9CA3AF] mt-1">Create a token to start sending traces from your agent.</p>
            </div>
          )}
          {!loadingTokens && tokens.length > 0 && (
            <div className="overflow-auto rounded-xl border border-[#E7DED1]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E7DED1] bg-[#FBFAF7]">
                    {["Name", "Environment", "Token", "Last used", "Created", "Expires", "Status", ""].map((h) => (
                      <th key={h} className="py-2 px-3 text-left text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {activeTokens.map((t) => (
                    <TokenRow key={t.id} token={t} onRotate={setRotateTarget} onRevoke={setRevokeTarget} canManage={isAdmin} />
                  ))}
                  {inactiveTokens.length > 0 && activeTokens.length > 0 && (
                    <tr className="border-b border-[#F1ECE3]">
                      <td colSpan={8} className="py-1.5 px-3 text-[10px] text-[#9CA3AF] uppercase tracking-wide font-semibold bg-[#FBFAF7]">
                        Inactive
                      </td>
                    </tr>
                  )}
                  {inactiveTokens.map((t) => (
                    <TokenRow key={t.id} token={t} onRotate={setRotateTarget} onRevoke={setRevokeTarget} canManage={isAdmin} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ── Endpoint + env var ───────────────────────────────────────────── */}
        <Section title="Ingest endpoint" icon={KeyRound} badge="REST" defaultOpen={false}>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-[#374151] mb-1.5">Endpoint URL</p>
              <div className="flex items-center gap-2 rounded-xl border border-[#E7DED1] bg-[#FBFAF7] px-3 py-2 font-mono text-xs text-[#111111]">
                <span className="flex-1 break-all">{ingestUrl}</span>
                <button type="button" onClick={() => void navigator.clipboard.writeText(ingestUrl)}>
                  <Copy className="h-3.5 w-3.5 text-[#9CA3AF] hover:text-[#2563EB]" />
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-[#374151] mb-1.5">Environment variable</p>
              <CodeBlock lang="env" code={`VECTORBEA_INGEST_TOKEN=your_generated_ingest_token\nVECTORBEA_INGEST_URL=${ingestUrl}`} />
            </div>
            <p className="text-xs text-[#6B7280]">
              Generated ingest tokens currently use the <code className="bg-[#F3F4F6] px-1 rounded">vb_li_</code> prefix for backward compatibility.
            </p>
          </div>
        </Section>

        {/* ── curl example ─────────────────────────────────────────────────── */}
        <Section title="curl — quick test" icon={Code2} badge="curl" defaultOpen={false}>
          <CodeBlock lang="bash" code={`curl -X POST ${ingestUrl} \\
  -H "Authorization: Bearer $VECTORBEA_INGEST_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "workspace_id": "${activeWorkspaceId ?? "YOUR_WORKSPACE_ID"}",
    "capability_id": "YOUR_CAPABILITY_ID",
    "events": [
      { "type": "agent_run_started", "metadata": { "user_input": "Hello" } },
      { "type": "llm_call", "model": "gpt-4o-mini", "latency_ms": 320, "cost_estimate": 0.0002 },
      { "type": "final_response", "final_response": "Hi there!", "outcome_status": "success" },
      { "type": "agent_run_finished" }
    ]
  }'`} />
        </Section>

        {/* ── Python SDK ───────────────────────────────────────────────────── */}
        <Section title="Python SDK" icon={Code2} badge="Python" defaultOpen={false}>
          <p className="text-xs text-[#6B7280]">Install: <code className="bg-[#F3F4F6] px-1 rounded">pip install vectorbea-sdk</code> (coming soon — use direct HTTP in the meantime)</p>
          <CodeBlock lang="python" code={`import os
import vectorbea

vb = vectorbea.init(
    ingest_url=os.getenv("VECTORBEA_INGEST_URL"),
    ingest_token=os.getenv("VECTORBEA_INGEST_TOKEN"),
    workspace_id="${activeWorkspaceId ?? "YOUR_WORKSPACE_ID"}",
    environment="production",
    service_name="refund-agent",
    redact_secrets=True,   # strips api_key, token, bearer, password…
    fail_open=True,        # agent continues if VectorBea is unreachable
)

trace = vb.start_agent_run(
    capability_id="YOUR_CAPABILITY_ID",
    user_id=request.user_id,
)

with trace.llm_call(provider="openai", model="gpt-4o-mini") as span:
    response = openai_client.chat.completions.create(...)
    span.record(input=messages, output=response.choices[0].message.content,
                cost_estimate=0.0004)

with trace.tool_call(tool_name="checkRefundEligibility") as span:
    result = check_refund_eligibility(order_id=order_id)
    span.record(arguments={"order_id": order_id}, result=result)

with trace.mcp_tool_call(server="shopify-mcp", tool="createRefund") as span:
    refund = mcp_client.call("shopify-mcp", "createRefund", {...})
    span.record(arguments={...}, result=refund)

trace.finish(final_response=reply, outcome_status="success")`} />
        </Section>

        {/* ── Proxy vs SDK ─────────────────────────────────────────────────── */}
        <Section title="Sidecar — recommended for enterprise production" icon={Layers} badge="Recommended" defaultOpen>
          <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-4">
            <p className="text-sm font-semibold text-[#1E3A8A]">Use the sidecar as the production ingestion layer</p>
            <p className="mt-1 text-xs text-[#1E40AF]">
              Your application or SDK emits semantic workflow events locally to the VectorBea sidecar over localhost or a shared Unix domain socket.
              The sidecar batches, redacts, buffers, and retries before forwarding telemetry to VectorBea with an ingest token.
            </p>
          </div>
          <CodeBlock lang="text" code={`App or SDK
  ↓ local HTTP or UDS
VectorBea Sidecar
  ↓ batched forward with ingest token
VectorBea backend
  ↓
workflow map, execution graph, regression, safety gates, governance, ROI`} />
          <p className="text-xs text-[#6B7280]">
            Direct API is best for quick testing. For production agent workloads, prefer SDK plus Sidecar or OpenTelemetry plus Sidecar.
          </p>
        </Section>

        <Section title="Proxy vs SDK responsibilities" icon={Activity} defaultOpen={false}>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              { title: "Proxy / Sidecar captures", items: ["LLM provider + model", "Prompt name + version", "Request & response bodies", "Latency + token counts", "Cost estimate"], note: "Does NOT see internal tool calls unless SDK spans are also sent" },
              { title: "SDK captures", items: ["Agent root trace (start/finish)", "Tool call spans with args + results", "MCP tool call spans", "RAG retrieval spans", "Human handoff events"], note: "Best production setup: Proxy + SDK together" },
            ].map(({ title, items, note }) => (
              <div key={title} className="rounded-xl border border-[#E7DED1] bg-[#FBFAF7] p-4 space-y-2">
                <p className="font-semibold text-[#111111] text-xs">{title}</p>
                <ul className="space-y-1 text-xs text-[#6B7280]">
                  {items.map((item) => <li key={item} className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-[#16A34A] shrink-0" />{item}</li>)}
                </ul>
                <p className="text-[11px] text-[#9CA3AF] italic">{note}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Redaction ────────────────────────────────────────────────────── */}
        <Section title="Secret redaction" icon={Shield} defaultOpen={false}>
          <p className="text-xs text-[#6B7280]">These keys are automatically stripped from all payloads before storage.</p>
          <div className="flex flex-wrap gap-1.5">
            {["authorization","api_key","apikey","password","secret","token","bearer","private_key","client_secret","access_token","refresh_token","ssn","credit_card"].map((k) => (
              <code key={k} className="rounded-md bg-[#FEF2F2] border border-[#FECACA] px-2 py-0.5 text-[11px] text-[#991B1B] font-mono">{k}</code>
            ))}
          </div>
          <p className="text-xs text-[#6B7280]">Bearer tokens matching <code className="bg-[#F3F4F6] px-1 rounded">Bearer [token]</code> in string values are also replaced with <code className="bg-[#F3F4F6] px-1 rounded">[REDACTED]</code>.</p>
        </Section>

        {/* ── OTEL mapping ─────────────────────────────────────────────────── */}
        <Section title="OpenTelemetry span mapping" icon={Activity} badge="OTEL" defaultOpen={false}>
          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead><tr className="border-b border-[#E7DED1]">
                <th className="text-left py-2 pr-4 font-semibold text-[#374151]">OTEL span name</th>
                <th className="text-left py-2 font-semibold text-[#374151]">VectorBea event type</th>
              </tr></thead>
              <tbody className="text-[#6B7280]">
                {[["agent.run","agent_run_started / agent_run_finished"],["llm.call","llm_call"],["tool.call","tool_call"],["mcp.tool.call","mcp_tool_call"],["rag.retrieve","rag_retrieve"],["response.final","final_response"],["human.handoff","human_handoff"]].map(([otel, vb]) => (
                  <tr key={otel} className="border-b border-[#F1ECE3]">
                    <td className="py-2 pr-4 font-mono text-[#2563EB]">{otel}</td>
                    <td className="py-2 font-mono text-[#111111]">{vb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── SDK config reference ─────────────────────────────────────────── */}
        <Section title="SDK configuration reference" icon={Code2} badge="Config" defaultOpen={false}>
          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead><tr className="border-b border-[#E7DED1]">
                {["Option","Default","Description"].map((h) => <th key={h} className="text-left py-2 pr-4 font-semibold text-[#374151]">{h}</th>)}
              </tr></thead>
              <tbody className="text-[#6B7280]">
                {[
                  ["ingest_url","required","VectorBea ingest endpoint URL"],
                  ["ingest_token","required","Bearer token from ingest token settings (Authorization Bearer or x-vectorbea-ingest-token)"],
                  ["workspace_id","required","Your VectorBea workspace ID"],
                  ["environment",`"production"`,"Tag traces with deployment env"],
                  ["capture_inputs","true","Include LLM prompt inputs in traces"],
                  ["capture_outputs","true","Include LLM outputs in traces"],
                  ["redact_secrets","true","Strip sensitive keys before sending"],
                  ["sample_rate","1.0","Fraction of traces to send (0.0–1.0)"],
                  ["fail_open","true","If VectorBea is unavailable, continue silently"],
                  ["batch_size","50","Max events per HTTP request"],
                  ["flush_interval_ms","5000","How often to flush the local event buffer"],
                ].map(([opt, def, desc]) => (
                  <tr key={opt} className="border-b border-[#F1ECE3]">
                    <td className="py-2 pr-4 font-mono text-[#111111]">{opt}</td>
                    <td className="py-2 pr-4 font-mono text-[#6B7280]">{def}</td>
                    <td className="py-2">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

      </div>

      {/* Dialogs */}
      {activeWorkspaceId && isAdmin && (
        <>
          <CreateTokenDialog open={showCreate} workspaceId={activeWorkspaceId} onClose={() => setShowCreate(false)} onCreated={handleCreated} />
          <RotateDialog token={rotateTarget} workspaceId={activeWorkspaceId} onClose={() => setRotateTarget(null)} onRotated={handleRotated} />
          <RevokeDialog token={revokeTarget} workspaceId={activeWorkspaceId} onClose={() => setRevokeTarget(null)} onRevoked={handleRevoked} />
        </>
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

      {/* ── Seconds timer for reveal badge ── */}
      {revealToken && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-2 text-xs font-medium text-[#1D4ED8] shadow-lg z-40">
          <Clock className="h-3.5 w-3.5" />
          Token visible — scroll up to copy before dismissing
        </div>
      )}
    </div>
  );
}
