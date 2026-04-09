"use client";

import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Rocket,
  Terminal,
  Wifi,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Code generation ─────────────────────────────────────────────────────────

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, "-") || "my-workspace";
}

function getDockerCommand(apiKey: string) {
  return `docker run -d \\
  --name vectorbee-proxy \\
  -p 4040:4040 \\
  -e VECTORBEE_API_KEY=${apiKey} \\
  vectorbee/proxy:latest`;
}

function getPythonSnippet(orgId: string, apiKey: string) {
  return `from vectorbee import VectorBeeClient
import openai

client = VectorBeeClient(
    proxy_url="http://localhost:4040",
    api_key="${apiKey}",
    organization_id="${orgId}",
)

# Fetch a published prompt by name
config = client.get_prompt("welcome-agent")

response = openai.chat.completions.create(**config.to_openai())`;
}

function getNodeSnippet(orgId: string, apiKey: string) {
  return `import { VectorBeeClient } from "@vectorbee/sdk";
import OpenAI from "openai";

const vb = new VectorBeeClient({
  proxyUrl: "http://localhost:4040",
  apiKey: "${apiKey}",
  organizationId: "${orgId}",
});

// Fetch a published prompt by name
const cfg = await vb.getPrompt("welcome-agent");

const res = await new OpenAI().chat.completions.create(cfg.toOpenAI());`;
}

// ─── Syntax highlighter ───────────────────────────────────────────────────────

type TokenKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "builtin"
  | "flag"
  | "op"
  | "plain";

type Token = { kind: TokenKind; value: string };

const PYTHON_KW = new Set([
  "from","import","async","await","def","class","return","if","else",
  "for","in","not","and","or","True","False","None","with","as","pass",
]);
const JS_KW = new Set([
  "import","export","from","const","let","var","async","await","return",
  "if","else","for","of","in","new","true","false","null","undefined",
  "function","class","extends","typeof","instanceof",
]);

function tokenize(code: string, lang: "python" | "js" | "bash"): Token[] {
  if (lang === "bash") return tokenizeBash(code);
  const keywords = lang === "python" ? PYTHON_KW : JS_KW;
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    // Single-line comment
    const commentChar = lang === "python" ? "#" : "//";
    if (code.startsWith(commentChar, i)) {
      const end = code.indexOf("\n", i);
      const val = end === -1 ? code.slice(i) : code.slice(i, end);
      tokens.push({ kind: "comment", value: val });
      i += val.length;
      continue;
    }
    // String (single or double, no multiline for simplicity)
    if (code[i] === '"' || code[i] === "'") {
      const q = code[i];
      let j = i + 1;
      while (j < code.length && code[j] !== q && code[j] !== "\n") {
        if (code[j] === "\\") j++;
        j++;
      }
      tokens.push({ kind: "string", value: code.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    // Template literal (JS)
    if (lang === "js" && code[i] === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== "`") {
        if (code[j] === "\\") j++;
        j++;
      }
      tokens.push({ kind: "string", value: code.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    // Number
    if (/[0-9]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[0-9.]/.test(code[j])) j++;
      tokens.push({ kind: "number", value: code.slice(i, j) });
      i = j;
      continue;
    }
    // Identifier / keyword
    if (/[a-zA-Z_$]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      tokens.push({
        kind: keywords.has(word) ? "keyword" : "plain",
        value: word,
      });
      i = j;
      continue;
    }
    // Operator / punctuation
    if (/[=<>!+\-*/%&|^~(){}[\],.:;]/.test(code[i])) {
      tokens.push({ kind: "op", value: code[i] });
      i++;
      continue;
    }
    tokens.push({ kind: "plain", value: code[i] });
    i++;
  }
  return tokens;
}

function tokenizeBash(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < code.length) {
    // Flag  --flag or -f
    if (
      code[i] === "-" &&
      i + 1 < code.length &&
      (code[i + 1] === "-" || /[a-z]/.test(code[i + 1]))
    ) {
      let j = i;
      while (j < code.length && !/[ \n\\]/.test(code[j])) j++;
      tokens.push({ kind: "flag", value: code.slice(i, j) });
      i = j;
      continue;
    }
    // ENV=value pattern
    if (/[A-Z_]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[A-Z0-9_]/.test(code[j])) j++;
      if (code[j] === "=") {
        tokens.push({ kind: "builtin", value: code.slice(i, j + 1) });
        i = j + 1;
        // value up to space/newline/backslash
        let k = i;
        while (k < code.length && !/[ \n\\]/.test(code[k])) k++;
        tokens.push({ kind: "string", value: code.slice(i, k) });
        i = k;
        continue;
      }
    }
    // word (command, image name, etc.)
    if (/[a-zA-Z0-9_/.:@-]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[a-zA-Z0-9_/.:@-]/.test(code[j])) j++;
      tokens.push({ kind: "plain", value: code.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ kind: "plain", value: code[i] });
    i++;
  }
  return tokens;
}

const KIND_CLASS: Record<TokenKind, string> = {
  keyword: "text-violet-400 font-medium",
  string:  "text-emerald-300",
  comment: "text-slate-500 italic",
  number:  "text-amber-300",
  builtin: "text-sky-300",
  flag:    "text-cyan-400",
  op:      "text-slate-400",
  plain:   "text-slate-200",
};

function CodeBlock({
  code,
  lang,
  label,
  className,
}: {
  code: string;
  lang: "python" | "js" | "bash";
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const tokens = tokenize(code, lang);

  const copy = async () => {
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1117] shadow-panel",
        className,
      )}
    >
      {/* Window chrome */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          {label}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-slate-500 transition-all hover:bg-white/5 hover:text-slate-300"
        >
          {copied ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      {/* Code */}
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-[1.8]">
        {tokens.map((t, idx) => (
          <span key={idx} className={KIND_CLASS[t.kind]}>
            {t.value}
          </span>
        ))}
      </pre>
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ["Workspace", "Language", "Quickstart"];

function StepDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, idx) => (
        <div key={label} className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300",
                idx < current
                  ? "border-primary/40 bg-primary/20 text-primary"
                  : idx === current
                    ? "border-primary bg-primary text-white shadow-glow"
                    : "border-white/10 bg-white/5 text-slate-500",
              )}
            >
              {idx < current ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                idx + 1
              )}
            </div>
            <span
              className={cn(
                "text-[10px] font-medium uppercase tracking-wider transition-colors duration-300",
                idx === current ? "text-primary" : "text-slate-600",
              )}
            >
              {label}
            </span>
          </div>
          {idx < STEPS.length - 1 && (
            <div
              className={cn(
                "mb-3.5 h-px w-10 transition-colors duration-500",
                idx < current ? "bg-primary/40" : "bg-white/8",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Slide variants ───────────────────────────────────────────────────────────


// ─── Language card ────────────────────────────────────────────────────────────

function LangCard({
  active,
  onClick,
  icon,
  label,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-all duration-200",
        active
          ? "border-primary/60 bg-primary/10 shadow-glow"
          : "border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]",
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
          active ? "bg-primary/20 text-primary" : "bg-white/5 text-slate-400",
        )}
      >
        {icon}
      </div>
      <div>
        <p
          className={cn(
            "font-semibold transition-colors",
            active ? "text-white" : "text-slate-300",
          )}
        >
          {label}
        </p>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
      {active && (
        <CheckCircle2 className="absolute right-4 top-4 h-4 w-4 text-primary" />
      )}
    </button>
  );
}

// ─── Listener pulse ───────────────────────────────────────────────────────────

function ListenerPulse({ connected }: { connected: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4 }}
      className={cn(
        "relative flex items-center gap-4 rounded-2xl border p-5 transition-all duration-700",
        connected
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-white/8 bg-white/[0.03]",
      )}
    >
      {/* Animated rings */}
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
        {!connected && (
          <>
            <motion.div
              className="absolute h-10 w-10 rounded-full border border-primary/30"
              animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.div
              className="absolute h-10 w-10 rounded-full border border-primary/20"
              animate={{ scale: [1, 2.4], opacity: [0.4, 0] }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeOut",
                delay: 0.4,
              }}
            />
          </>
        )}
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-500",
            connected ? "bg-emerald-500/20" : "bg-primary/10",
          )}
        >
          {connected ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          ) : (
            <Wifi className="h-5 w-5 text-primary" />
          )}
        </div>
      </div>

      <div className="min-w-0">
        <p className="font-medium text-slate-200">
          {connected
            ? "Connection established!"
            : "Listening for your first local proxy connection…"}
        </p>
        <p className="mt-0.5 text-sm text-slate-500">
          {connected
            ? "Your proxy is live. Redirecting to your dashboard."
            : "Start the proxy with the docker command above, then run your agent."}
        </p>
      </div>

      {!connected && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-primary"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
              }}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const PLACEHOLDER_KEY = "vb_••••••••••••••••••••••••••••";

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [workspace, setWorkspace] = useState("");
  const [lang, setLang] = useState<"python" | "js">("python");
  const [connected, setConnected] = useState(false);
  const [testing, setTesting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  const handleCreateWorkspace = useCallback(async () => {
    if (!workspace.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const orgRes = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspace.trim() }),
      });
      if (!orgRes.ok) throw new Error(await orgRes.text());
      const org = (await orgRes.json()) as { id: string };

      const keyRes = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: org.id }),
      });
      if (!keyRes.ok) throw new Error(await keyRes.text());
      const key = (await keyRes.json()) as { apiKey: string };

      setOrgId(org.id);
      setApiKey(key.apiKey);
      go(1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setCreating(false);
    }
  }, [workspace, creating]);

  // Poll the backend for a real connection — no fake pass.
  const handleTestConnection = useCallback(async () => {
    if (!orgId || testing) return;
    setTesting(true);

    const deadline = Date.now() + 90_000; // 90s window
    let success = false;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(
          `/api/dashboard/connection-status?organizationId=${encodeURIComponent(orgId)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = (await res.json()) as { connected: boolean };
          if (data.connected) {
            success = true;
            break;
          }
        }
      } catch {
        // ignore and retry
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!success) {
      setTesting(false);
      setCreateError(
        "We didn't see any traffic from your proxy yet. Make sure the docker container is running and your agent has made at least one call.",
      );
      return;
    }

    const { default: confetti } = await import("canvas-confetti");
    const fire = (originX: number, originY: number) =>
      confetti({
        particleCount: 90,
        spread: 70,
        origin: { x: originX, y: originY },
        colors: ["#6366f1", "#8b5cf6", "#a78bfa", "#22d3ee", "#34d399"],
        startVelocity: 45,
        gravity: 0.9,
        ticks: 200,
      });
    fire(0.1, 0.6);
    fire(0.9, 0.6);
    setTimeout(() => fire(0.5, 0.8), 300);

    setConnected(true);
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 2200);
  }, [orgId, testing]);

  // Per-step slide direction for enter/exit animations
  const enterX  = direction * 40;
  const exitX   = direction * -40;

  const code =
    lang === "python"
      ? getPythonSnippet(orgId ?? "<your-org-id>", apiKey ?? PLACEHOLDER_KEY)
      : getNodeSnippet(orgId ?? "<your-org-id>", apiKey ?? PLACEHOLDER_KEY);
  const codeLang = lang === "python" ? ("python" as const) : ("js" as const);
  const codeLabel =
    lang === "python" ? "my_agent.py" : "my-agent.mjs";

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-16">
      {/* Grid background */}
      <div
        className="pointer-events-none absolute inset-0 bg-grid-fade"
        style={{ backgroundSize: "100% 100%, 24px 24px, 24px 24px" }}
      />
      {/* Glow blobs */}
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2">
        <div className="h-[480px] w-[640px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      {/* Panel */}
      <div className="relative z-10 w-full max-w-xl">
        {/* Brand */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex flex-col items-center gap-2 text-center"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
              VectorBee
            </p>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-white">
              Let&apos;s get you set up
            </h1>
          </div>
          <div className="mt-2">
            <StepDots current={step} />
          </div>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="overflow-hidden rounded-3xl border border-white/8 bg-card/80 shadow-panel backdrop-blur-xl"
        >
          <AnimatePresence mode="wait" initial={false}>
            {/* ── Step 0: Workspace name ─────────────────── */}
            {step === 0 && (
              <motion.div
                key="step-0"
                initial={{ opacity: 0, x: enterX }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: exitX }}
                transition={{ duration: 0.32, ease: "easeOut" }}
                className="p-8"
              >
                <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
                  <Terminal className="h-5 w-5 text-primary" />
                </div>
                <h2 className="text-xl font-semibold text-white">
                  Name your workspace
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  This becomes the namespace for all your prompts and API keys.
                  You can rename it later.
                </p>

                <div className="mt-7 space-y-3">
                  <label className="text-sm font-medium text-slate-300">
                    Workspace name
                  </label>
                  <Input
                    autoFocus
                    placeholder="e.g. Acme AI Platform"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && workspace.trim()) handleCreateWorkspace();
                    }}
                    className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-600 focus:border-primary/60 focus:ring-primary/20"
                  />
                  <p className="text-xs text-slate-600">
                    Slug:{" "}
                    <span className="font-mono text-slate-400">
                      {slugify(workspace || "my-workspace")}
                    </span>
                  </p>
                </div>

                {createError && (
                  <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {createError}
                  </p>
                )}

                <div className="mt-8 flex justify-end">
                  <Button
                    onClick={handleCreateWorkspace}
                    disabled={!workspace.trim() || creating}
                    className="gap-2 px-6"
                  >
                    {creating ? "Creating…" : "Continue"}
                    {!creating && <ArrowRight className="h-4 w-4" />}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── Step 1: Language ────────────────────────── */}
            {step === 1 && (
              <motion.div
                key="step-1"
                initial={{ opacity: 0, x: enterX }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: exitX }}
                transition={{ duration: 0.32, ease: "easeOut" }}
                className="p-8"
              >
                <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20">
                  <Rocket className="h-5 w-5 text-violet-400" />
                </div>
                <h2 className="text-xl font-semibold text-white">
                  Choose your language
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  We&apos;ll tailor the quickstart code snippet to your stack.
                </p>

                <div className="mt-7 grid grid-cols-2 gap-3">
                  <LangCard
                    active={lang === "python"}
                    onClick={() => setLang("python")}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                        <path d="M12 2C6.63 2 7 4.33 7 4.33V6.67H12.07V7.33H4.67S2 7.03 2 12.43s2.33 5.27 2.33 5.27H5.7v-2.53s-.07-2.33 2.3-2.33h4c0 0 2.23.04 2.23-2.17V4.5S14.6 2 12 2zm-1.33 1.53c.41 0 .73.33.73.73 0 .41-.33.73-.73.73-.41 0-.73-.33-.73-.73 0-.41.33-.73.73-.73z" />
                        <path d="M12 22c5.37 0 5-2.33 5-2.33v-2.34h-5.07v-.66h7.4S22 16.97 22 11.57s-2.33-5.27-2.33-5.27H18.3v2.53s.07 2.33-2.3 2.33h-4s-2.23-.04-2.23 2.17v4.17S9.4 22 12 22zm1.33-1.53c-.41 0-.73-.33-.73-.73 0-.41.33-.73.73-.73.41 0 .73.33.73.73 0 .41-.33.73-.73.73z" />
                      </svg>
                    }
                    label="Python"
                    description="vectorbee SDK via pip"
                  />
                  <LangCard
                    active={lang === "js"}
                    onClick={() => setLang("js")}
                    icon={
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                        <path d="M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z" />
                      </svg>
                    }
                    label="Node.js"
                    description="@vectorbee/sdk via npm"
                  />
                </div>

                <div className="mt-8 flex justify-between">
                  <Button variant="ghost" onClick={() => go(0)} className="gap-1.5">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                  <Button onClick={() => go(2)} className="gap-2 px-6">
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── Step 2: Quickstart ──────────────────────── */}
            {step === 2 && (
              <motion.div
                key="step-2"
                initial={{ opacity: 0, x: enterX }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: exitX }}
                transition={{ duration: 0.32, ease: "easeOut" }}
                className="p-8"
              >
                <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20">
                  <Zap className="h-5 w-5 text-emerald-400" />
                </div>
                <h2 className="text-xl font-semibold text-white">
                  Launch the proxy &amp; run your agent
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Two commands and you&apos;re live. VectorBee intercepts every
                  OpenAI call automatically.
                </p>

                <div className="mt-6 space-y-4">
                  {/* Credentials block — show ONCE, copy now */}
                  {apiKey && orgId && (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Wifi className="h-3.5 w-3.5 text-amber-400" />
                        <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">
                          Save these credentials — shown only once
                        </p>
                      </div>

                      <div className="space-y-2.5">
                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                            API Key
                          </p>
                          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                            <code className="flex-1 truncate font-mono text-xs text-amber-200">
                              {apiKey}
                            </code>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard.writeText(apiKey)}
                              className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                              aria-label="Copy API key"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                            Organization ID
                          </p>
                          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                            <code className="flex-1 truncate font-mono text-xs text-slate-300">
                              {orgId}
                            </code>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard.writeText(orgId)}
                              className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
                              aria-label="Copy organization ID"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Docker command */}
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-500">
                      1 · Start the proxy
                    </p>
                    <CodeBlock
                      code={getDockerCommand(apiKey ?? PLACEHOLDER_KEY)}
                      lang="bash"
                      label="terminal"
                    />
                  </div>

                  {/* SDK snippet */}
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-widest text-slate-500">
                      2 · Use it in your agent
                    </p>
                    <CodeBlock
                      code={code}
                      lang={codeLang}
                      label={codeLabel}
                    />
                  </div>

                  {/* Listener */}
                  <div className="pt-1">
                    <ListenerPulse connected={connected} />
                  </div>

                  {createError && (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      {createError}
                    </p>
                  )}

                  {/* Test connection button */}
                  {!connected && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                      className="flex items-center justify-between rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-300">
                          Listen for first call
                        </p>
                        <p className="text-xs text-slate-500">
                          We&apos;ll watch your workspace for incoming traffic
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={testing || !orgId}
                        className="shrink-0 border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                      >
                        {testing ? (
                          <>
                            <motion.span
                              animate={{ rotate: 360 }}
                              transition={{
                                duration: 0.7,
                                repeat: Infinity,
                                ease: "linear",
                              }}
                              className="mr-1.5 block h-3.5 w-3.5 rounded-full border-2 border-primary border-t-transparent"
                            />
                            Listening…
                          </>
                        ) : (
                          "Start listening"
                        )}
                      </Button>
                    </motion.div>
                  )}
                </div>

                <div className="mt-6 flex justify-between">
                  <Button variant="ghost" onClick={() => go(1)} className="gap-1.5">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => { window.location.href = "/dashboard"; }}
                    className="text-slate-500 hover:text-slate-300"
                  >
                    Skip to dashboard →
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Footer */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-6 text-center text-xs text-slate-600"
        >
          VectorBee · Prompt infrastructure for production AI
        </motion.p>
      </div>
    </div>
  );
}
