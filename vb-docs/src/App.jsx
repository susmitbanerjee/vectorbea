import { useState } from 'react'
import {
  AlertTriangle,
  Info,
  Copy,
  Check,
  ChevronRight,
  BookOpen,
  Zap,
  Terminal,
  Settings,
  Layers,
  Key,
  Shield,
  BarChart2,
  ExternalLink,
  Menu,
  X,
} from 'lucide-react'

// ─── Sidebar nav data ─────────────────────────────────────────────────────────

const NAV = [
  {
    section: 'Getting Started',
    items: [
      { label: 'Introduction',  icon: BookOpen, href: '#' },
      { label: 'Quickstart',    icon: Zap,       href: '#', active: true },
      { label: 'Core Concepts', icon: Layers,    href: '#' },
    ],
  },
  {
    section: 'Configuration',
    items: [
      { label: 'Authentication', icon: Key,      href: '#' },
      { label: 'Environments',   icon: Settings, href: '#' },
      { label: 'Sidecar Config', icon: Terminal, href: '#' },
    ],
  },
  {
    section: 'Platform',
    items: [
      { label: 'Security',  icon: Shield,    href: '#' },
      { label: 'Telemetry', icon: BarChart2, href: '#' },
    ],
  },
]

// ─── Copy button hook ─────────────────────────────────────────────────────────

function useCopy(text) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return [copied, copy]
}

// ─── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({ lang = 'BASH', code }) {
  const [copied, copy] = useCopy(code)
  return (
    <div className="rounded-lg overflow-hidden border border-zinc-800 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 border-b border-zinc-800">
        <span className="text-[10px] font-semibold tracking-[0.12em] text-zinc-500 uppercase select-none">
          {lang}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-[11px] text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span className="text-[11px]">Copy</span>
            </>
          )}
        </button>
      </div>
      {/* Code */}
      <pre className="bg-zinc-950 text-zinc-100 text-[12.5px] leading-[1.75] px-5 py-4 overflow-x-auto m-0">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function Tabs({ tabs, panels }) {
  const [active, setActive] = useState(0)
  return (
    <div className="rounded-lg border border-zinc-200 overflow-hidden">
      {/* Tab strip */}
      <div className="flex items-center bg-white border-b border-zinc-200">
        {tabs.map((label, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className={[
              'relative px-4 py-2.5 text-[12.5px] font-medium transition-colors select-none cursor-pointer',
              'focus:outline-none',
              active === i
                ? 'text-zinc-900 after:absolute after:bottom-0 after:inset-x-0 after:h-[2px] after:bg-zinc-900'
                : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Panel — no extra border radius so it blends with the container */}
      <div className="[&_.rounded-lg]:rounded-none [&_.rounded-lg]:border-0 [&_.rounded-lg]:shadow-none">
        {panels[active]}
      </div>
    </div>
  )
}

// ─── Callouts ─────────────────────────────────────────────────────────────────

function Warning({ children }) {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3.5">
      <AlertTriangle size={14} className="text-amber-500 mt-[2px] shrink-0" />
      <p className="text-[13px] leading-relaxed text-amber-900">{children}</p>
    </div>
  )
}

function InfoNote({ children }) {
  return (
    <div className="flex gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3.5">
      <Info size={14} className="text-sky-500 mt-[2px] shrink-0" />
      <p className="text-[13px] leading-relaxed text-sky-900">{children}</p>
    </div>
  )
}

// ─── Inline code ─────────────────────────────────────────────────────────────

function IC({ children }) {
  return (
    <code className="inline font-mono text-[11.5px] bg-zinc-100 border border-zinc-200 text-zinc-700 rounded px-1.5 py-0.5 leading-none">
      {children}
    </code>
  )
}

// ─── Step badge ───────────────────────────────────────────────────────────────

function StepBadge({ n }) {
  return (
    <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-zinc-900 text-white text-[10px] font-bold shrink-0 mt-[1px]">
      {n}
    </span>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ open, onClose }) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/25 z-20 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={[
          'fixed top-0 left-0 h-screen w-[220px] bg-white border-r border-zinc-200',
          'flex flex-col z-30 transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-zinc-200 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-[22px] h-[22px] rounded-[5px] bg-zinc-900 flex items-center justify-center shrink-0">
              <Zap size={12} className="text-white" />
            </div>
            <span className="text-[13px] font-semibold tracking-tight text-zinc-900 leading-none">
              VectorBea
              <span className="font-normal text-zinc-400"> /docs</span>
            </span>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1 text-zinc-400 hover:text-zinc-700 cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {NAV.map((group) => (
            <div key={group.section}>
              <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-400 px-2 mb-1">
                {group.section}
              </p>
              {group.items.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className={[
                    'flex items-center gap-2 px-2 py-[6px] rounded-[5px] text-[13px] transition-colors',
                    item.active
                      ? 'text-zinc-900 font-medium bg-zinc-100 border-l-2 border-zinc-900 !rounded-l-none pl-[6px]'
                      : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50',
                  ].join(' ')}
                >
                  <item.icon size={13} className="shrink-0" />
                  {item.label}
                </a>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-zinc-200 px-4 py-3">
          <a
            href="#"
            className="flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            <ExternalLink size={11} />
            API Reference
          </a>
        </div>
      </aside>
    </>
  )
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb() {
  return (
    <nav className="flex items-center gap-1 text-[12px] text-zinc-400 mb-7">
      <span className="hover:text-zinc-600 cursor-pointer transition-colors">Docs</span>
      <ChevronRight size={11} className="text-zinc-300" />
      <span className="hover:text-zinc-600 cursor-pointer transition-colors">Getting Started</span>
      <ChevronRight size={11} className="text-zinc-300" />
      <span className="text-zinc-600 font-medium">Quickstart</span>
    </nav>
  )
}

// ─── On-page TOC ──────────────────────────────────────────────────────────────

const TOC_ITEMS = [
  { label: 'Prerequisites',         href: '#prerequisites' },
  { label: 'Install the CLI',       href: '#install-cli' },
  { label: 'Pull the sidecar',      href: '#pull-sidecar' },
  { label: 'Configure your agent',  href: '#configure' },
  { label: 'Run & verify',          href: '#run-verify' },
]

function TableOfContents() {
  return (
    <aside className="hidden xl:block w-[180px] shrink-0 pt-[3px]">
      <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-400 mb-3">
        On this page
      </p>
      <ul className="space-y-2">
        {TOC_ITEMS.map((t) => (
          <li key={t.href}>
            <a
              href={t.href}
              className="block text-[12px] text-zinc-400 hover:text-zinc-800 transition-colors leading-snug"
            >
              {t.label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}

// ─── Code snippets ────────────────────────────────────────────────────────────

const CODE = {
  install: `# macOS / Linux
curl -fsSL https://cli.vectorbea.com/install.sh | bash

# Verify installation
vectorbea --version`,

  pullX86: `# Pull the VectorBea sidecar (Intel / AMD x86-64)
docker pull vectorbea/vectorbea-proxy:latest

# Verify the image digest
docker inspect \\
  --format='{{index .RepoDigests 0}}' \\
  vectorbea/vectorbea-proxy:latest`,

  pullArm: `# Pull the VectorBea sidecar (Apple Silicon / ARM64)
docker pull --platform linux/arm64 \\
  vectorbea/vectorbea-proxy:latest

# Verify the image digest
docker inspect \\
  --format='{{index .RepoDigests 0}}' \\
  vectorbea/vectorbea-proxy:latest`,

  configure: `# Initialize a new agent workspace
vectorbea init --name "my-agent" --env production

# Store your API key (written to ~/.vectorbea/credentials)
vectorbea auth login`,

  run: `# Start the sidecar bound to your agent
vectorbea proxy start --agent-id <YOUR_AGENT_ID>

# Confirm the proxy is healthy
curl http://localhost:8080/v1/health
# → {"status":"ok","version":"0.1.0"}`,
}

// ─── Page body ────────────────────────────────────────────────────────────────

function PageContent() {
  return (
    <article className="min-w-0 flex-1 max-w-[680px]">
      <Breadcrumb />

      {/* Page header */}
      <header className="mb-8 pb-7 border-b border-zinc-200">
        <div className="flex items-center gap-2 mb-3.5">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[0.08em] uppercase text-zinc-500 border border-zinc-200 rounded-md px-2 py-[3px]">
            <Zap size={9} strokeWidth={2.5} />
            Getting Started
          </span>
          <span className="text-[11px] text-zinc-400">5 min read</span>
        </div>
        <h1 className="text-[26px] font-bold tracking-[-0.03em] text-zinc-900 mb-3 leading-tight">
          Quickstart
        </h1>
        <p className="text-[14px] text-zinc-500 leading-relaxed max-w-[560px]">
          Deploy the VectorBea sidecar proxy alongside your AI agent in under
          five minutes. This guide covers CLI setup, Docker image pull, and
          your first authenticated prompt request.
        </p>
      </header>

      {/* ── Warning ── */}
      <Warning>
        <strong className="font-semibold">Action required before deploying.&nbsp;</strong>
        After saving your agent configuration you must click{' '}
        <kbd className="inline-flex items-center font-mono text-[11px] bg-amber-100 border border-amber-300 text-amber-800 rounded px-1.5 py-0.5 not-italic">
          Publish
        </kbd>
        {' '}in the VectorBea dashboard.{' '}
        <kbd className="inline-flex items-center font-mono text-[11px] bg-amber-100 border border-amber-300 text-amber-800 rounded px-1.5 py-0.5 not-italic">
          Save
        </kbd>{' '}
        only stages the changes — the sidecar keeps serving the previous
        version until you publish.
      </Warning>

      {/* ── Step 1: Prerequisites ── */}
      <section id="prerequisites" className="mt-9">
        <div className="flex items-start gap-3 mb-3">
          <StepBadge n="1" />
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-zinc-900 leading-snug">
              Prerequisites
            </h2>
            <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">
              Confirm these before starting.
            </p>
          </div>
        </div>
        <ul className="ml-[34px] space-y-2">
          {[
            <>Docker ≥ 24 installed and the daemon running</>,
            <>A VectorBea workspace — create one at <a href="#" className="text-zinc-700 underline underline-offset-2 decoration-zinc-300 hover:decoration-zinc-600 transition-colors">app.vectorbea.com</a></>,
            <>An agent API token from <IC>Settings → API Keys</IC></>,
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px] text-zinc-600 leading-relaxed">
              <span className="mt-[7px] w-[5px] h-[5px] rounded-full bg-zinc-300 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Step 2: Install CLI ── */}
      <section id="install-cli" className="mt-9">
        <div className="flex items-start gap-3 mb-3">
          <StepBadge n="2" />
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-zinc-900 leading-snug">
              Install the CLI
            </h2>
            <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">
              The <IC>vectorbea</IC> CLI manages workspaces, credentials, and
              proxy lifecycle directly from your terminal.
            </p>
          </div>
        </div>
        <div className="ml-[34px]">
          <CodeBlock code={CODE.install} />
        </div>
      </section>

      {/* ── Step 3: Pull sidecar ── */}
      <section id="pull-sidecar" className="mt-9">
        <div className="flex items-start gap-3 mb-3">
          <StepBadge n="3" />
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-zinc-900 leading-snug">
              Pull the sidecar image
            </h2>
            <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">
              Select the architecture that matches your machine. Both variants
              are built from the same source and tagged <IC>:latest</IC>.
            </p>
          </div>
        </div>
        <div className="ml-[34px] space-y-3">
          <Tabs
            tabs={['Intel / AMD (x86-64)', 'Apple Silicon / ARM64']}
            panels={[
              <CodeBlock key="x86" code={CODE.pullX86} />,
              <CodeBlock key="arm" code={CODE.pullArm} />,
            ]}
          />
          <InfoNote>
            The pull is roughly{' '}
            <strong className="font-semibold">150 MB</strong>. You only need
            to do this once — Docker caches the image layers locally and reuses
            them on every subsequent container start without re-downloading.
          </InfoNote>
        </div>
      </section>

      {/* ── Step 4: Configure ── */}
      <section id="configure" className="mt-9">
        <div className="flex items-start gap-3 mb-3">
          <StepBadge n="4" />
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-zinc-900 leading-snug">
              Configure your agent
            </h2>
            <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">
              Initialise a workspace and authenticate. Credentials are stored
              in <IC>~/.vectorbea/credentials</IC> and never sent in plaintext.
            </p>
          </div>
        </div>
        <div className="ml-[34px]">
          <CodeBlock code={CODE.configure} />
        </div>
      </section>

      {/* ── Step 5: Run ── */}
      <section id="run-verify" className="mt-9">
        <div className="flex items-start gap-3 mb-3">
          <StepBadge n="5" />
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-zinc-900 leading-snug">
              Run &amp; verify
            </h2>
            <p className="text-[13px] text-zinc-500 mt-1 leading-relaxed">
              Start the proxy and confirm it responds on the health endpoint.
              A <IC>200 OK</IC> with <IC>"status":"ok"</IC> means the sidecar
              is live and connected to the hub.
            </p>
          </div>
        </div>
        <div className="ml-[34px]">
          <CodeBlock code={CODE.run} />
        </div>
      </section>

      {/* ── Next steps ── */}
      <section className="mt-12 pt-8 border-t border-zinc-200">
        <p className="text-[10.5px] font-semibold tracking-[0.1em] uppercase text-zinc-400 mb-4">
          Next Steps
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { title: 'Core Concepts',   desc: 'Prompts, versions, and the caching model.', href: '#' },
            { title: 'Authentication',  desc: 'Rotate tokens and configure scoped keys.',   href: '#' },
            { title: 'Sidecar Config',  desc: 'Advanced proxy tuning and UDS options.',     href: '#' },
            { title: 'Telemetry',       desc: 'Connect the metrics and audit pipeline.',    href: '#' },
          ].map((card) => (
            <a
              key={card.title}
              href={card.href}
              className="group flex flex-col gap-1 rounded-lg border border-zinc-200 px-4 py-3.5 hover:border-zinc-400 hover:bg-zinc-50/60 transition-all"
            >
              <span className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-zinc-900">{card.title}</span>
                <ChevronRight
                  size={13}
                  className="text-zinc-300 group-hover:text-zinc-600 transition-colors"
                />
              </span>
              <span className="text-[12px] text-zinc-500 leading-snug">{card.desc}</span>
            </a>
          ))}
        </div>
      </section>

      <div className="h-20" />
    </article>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Push content right of the fixed sidebar */}
      <div className="lg:pl-[220px]">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-10 flex items-center gap-3 h-14 px-4 bg-white border-b border-zinc-200">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
          >
            <Menu size={17} />
          </button>
          <span className="text-[13px] font-semibold tracking-tight text-zinc-900">
            VectorBea <span className="font-normal text-zinc-400">/docs</span>
          </span>
        </header>

        {/* Content area */}
        <div className="max-w-5xl mx-auto px-6 lg:px-12 xl:px-16 pt-10 flex gap-16">
          <PageContent />
          <TableOfContents />
        </div>
      </div>
    </div>
  )
}
