"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Lock, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PLANS: Record<string, { name: string; basePrice: number; perSeat: boolean }> = {
  developer: { name: "Developer", basePrice: 0, perSeat: false },
  team: { name: "Team", basePrice: 29, perSeat: true },
  enterprise: { name: "Enterprise", basePrice: 0, perSeat: false },
};

type Cycle = "monthly" | "annual" | "quarterly";
const CYCLE_LABELS: Record<Cycle, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly (NET-30)",
  annual: "Annual (save 20%)",
};

export default function CheckoutForm() {
  const params = useSearchParams();
  const planId = (params.get("plan") ?? "team").toLowerCase();
  const plan = PLANS[planId] ?? PLANS.team;

  const [seats, setSeats] = useState(3);
  const [cycle, setCycle] = useState<Cycle>("annual");
  const [email, setEmail] = useState("");
  const [card, setCard] = useState("");
  const [name, setName] = useState("");
  const [zip, setZip] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const subtotal = useMemo(() => {
    if (planId === "developer") return 0;
    if (planId === "enterprise") return 0;
    return plan.basePrice * Math.max(1, seats);
  }, [planId, seats, plan.basePrice]);

  const cycleMultiplier = cycle === "annual" ? 12 * 0.8 : cycle === "quarterly" ? 3 : 1;
  const total = subtotal * cycleMultiplier;

  const canSubmit =
    email.trim().length > 3 &&
    (planId === "developer" || (card.replace(/\s/g, "").length >= 12 && name.trim() && zip.trim()));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    // Simulate payment processor round-trip.
    await new Promise((r) => setTimeout(r, 1400));
    setSuccess(true);
    setSubmitting(false);
  };

  if (success) {
    return (
      <div className="relative min-h-screen bg-background text-white">
        <div className="pointer-events-none absolute inset-0 bg-grid-fade" style={{ backgroundSize: "100% 100%, 24px 24px, 24px 24px" }} />
        <div className="relative z-10 mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
            <Check className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold">Payment confirmed</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Your <span className="text-white">{plan.name}</span> subscription is active. We&apos;ve sent a receipt to <span className="text-white">{email}</span>.
          </p>
          <Link
            href="/onboarding"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-white hover:bg-primary/90"
          >
            Continue to setup <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background text-white">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade" style={{ backgroundSize: "100% 100%, 24px 24px, 24px 24px" }} />
      <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2">
        <div className="h-[500px] w-[700px] rounded-full bg-primary/8 blur-[140px]" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <Link href="/pricing" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to pricing
        </Link>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" /> Secure checkout
        </div>
      </header>

      <main className="relative z-10 mx-auto grid max-w-5xl gap-10 px-6 py-12 md:grid-cols-[1fr_360px]">
        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="space-y-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Step 1</p>
            <h2 className="mt-1 text-xl font-semibold">Workspace details</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Billing email</label>
                <Input
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-600"
                />
              </div>
            </div>
          </div>

          {plan.perSeat && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Step 2</p>
              <h2 className="mt-1 text-xl font-semibold">Plan configuration</h2>

              <div className="mt-4">
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Seats</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSeats((s) => Math.max(1, s - 1))}
                    className="h-10 w-10 rounded-lg border border-white/10 bg-white/5 text-lg font-medium text-white hover:bg-white/10"
                  >
                    −
                  </button>
                  <Input
                    type="number"
                    min={1}
                    value={seats}
                    onChange={(e) => setSeats(Math.max(1, parseInt(e.target.value) || 1))}
                    className="h-10 w-24 border-white/10 bg-white/5 text-center text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setSeats((s) => s + 1)}
                    className="h-10 w-10 rounded-lg border border-white/10 bg-white/5 text-lg font-medium text-white hover:bg-white/10"
                  >
                    +
                  </button>
                  <p className="ml-2 text-xs text-slate-500">Pro-rated daily for adds & removes</p>
                </div>
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-xs font-medium text-slate-400">Billing cycle</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(CYCLE_LABELS) as Cycle[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCycle(c)}
                      className={cn(
                        "rounded-xl border px-3 py-3 text-left text-sm transition-all",
                        cycle === c
                          ? "border-primary/50 bg-primary/10 text-white"
                          : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20",
                      )}
                    >
                      <p className="font-medium">{CYCLE_LABELS[c]}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {c === "annual" ? "20% off" : c === "quarterly" ? "Enterprise" : "Cancel anytime"}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {planId !== "developer" && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Step 3</p>
              <h2 className="mt-1 text-xl font-semibold">Payment details</h2>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">Cardholder name</label>
                  <Input
                    placeholder="Jane Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-600"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">Card number</label>
                  <Input
                    inputMode="numeric"
                    placeholder="4242 4242 4242 4242"
                    value={card}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 16);
                      setCard(digits.replace(/(.{4})/g, "$1 ").trim());
                    }}
                    className="h-11 border-white/10 bg-white/5 font-mono text-white placeholder:text-slate-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">Expiry</label>
                    <Input
                      placeholder="MM / YY"
                      className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">ZIP / Postal</label>
                    <Input
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      placeholder="94103"
                      className="h-11 border-white/10 bg-white/5 text-white placeholder:text-slate-600"
                    />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-slate-600">
                Demo checkout — no card is actually charged. Use any 16-digit number to test the flow.
              </p>
            </div>
          )}

          <Button type="submit" disabled={!canSubmit || submitting} className="h-12 w-full gap-2 text-sm">
            {submitting ? "Processing…" : planId === "developer" ? "Activate free plan" : `Subscribe — $${total.toFixed(0)}`}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </Button>
        </form>

        {/* ── Order summary ── */}
        <aside className="h-fit rounded-2xl border border-white/8 bg-card/40 p-6 backdrop-blur-xl">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Order summary</p>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-slate-400">Plan</span>
              <span className="font-medium text-white">{plan.name}</span>
            </div>
            {plan.perSeat && (
              <div className="flex items-baseline justify-between">
                <span className="text-slate-400">Seats × ${plan.basePrice}/mo</span>
                <span className="font-medium text-white">{seats}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between">
              <span className="text-slate-400">Billing cycle</span>
              <span className="font-medium text-white">{CYCLE_LABELS[cycle]}</span>
            </div>
          </div>

          <div className="my-5 border-t border-white/8" />

          <div className="flex items-baseline justify-between text-lg">
            <span className="text-slate-400">Total due today</span>
            <span className="font-bold text-white">${total.toFixed(0)}</span>
          </div>
          {cycle === "annual" && plan.perSeat && (
            <p className="mt-2 text-[11px] text-emerald-400">
              You save ${(plan.basePrice * seats * 12 * 0.2).toFixed(0)} with annual billing
            </p>
          )}

          <ul className="mt-6 space-y-2 text-xs text-slate-400">
            <li className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 text-emerald-400" /> 14-day free trial included</li>
            <li className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 text-emerald-400" /> Cancel anytime, no questions</li>
            <li className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 text-emerald-400" /> Pro-rated seat changes</li>
          </ul>
        </aside>
      </main>
    </div>
  );
}
