import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { SiteHeader, SiteFooter } from "@/components/marketing/site-chrome";
import { Checkpoint } from "@/components/marketing/logo";
import { JsonLd } from "@/components/seo/json-ld";
import { createMetadata, breadcrumbSchema } from "@/lib/seo";
import {
  PLANS, PLAN_CODES, MATRIX, MATRIX_VALUES, formatValue, priceLabel,
  type PlanCode,
} from "@/lib/marketing/plans";

/* ══════════════════════════════════════════════════════════════════════════════
   PRICING.

   ── EVERY NUMBER ON THIS PAGE IS PINNED TO THE PLAN RECORDS ─────────────────
   The grid comes from `@/lib/marketing/plans`, and
   `__tests__/pricing-consistency.test.ts` parses V060/V061/V062 and fails the
   build if it drifts. The pricing page, the in-product feature gates and the
   entitlement guards are three surfaces describing the same limits; making the
   disagreement a build failure is cheaper than making it a policy.

   ── FLAGGED-OFF FEATURES ARE MARKED, NOT SOLD ───────────────────────────────
   Agent teams, delegation and OpenTelemetry export are behind runtime switches
   that default to off. They stay on the page, because a buyer cannot evaluate
   what they cannot see — and they carry a caveat that names the switch, because
   the alternative is selling somebody Team for a feature their deployment will
   refuse.

   ── WHAT IS NOT ON THIS PAGE ────────────────────────────────────────────────
   An uptime figure, an SLA, a compliance badge, or a latency number. There is no
   SLA to publish, no audit has been done, and no benchmark has been run. Each of
   those is the first thing a serious buyer checks, and the first one they find to
   be untrue is the last claim of ours they believe.
══════════════════════════════════════════════════════════════════════════════ */

export const metadata: Metadata = createMetadata({
  title: "Pricing",
  description:
    "Four plans, with the limits stated as numbers: runs, tokens, agents, retention and concurrency. "
    + "Free is a real workspace, not a trial.",
  path: "/pricing",
});

const NOT_YET_ON: ReadonlySet<string> = new Set(
  MATRIX.filter((r) => r.caveat).map((r) => r.key),
);

export default function PricingPage() {
  return (
    <div className="min-h-screen w-full overflow-x-hidden" style={{ background: "#F7F8F9", color: "#0B0D0F" }}>
      <JsonLd data={[breadcrumbSchema([{ name: "Vectorbea", path: "/" }, { name: "Pricing", path: "/pricing" }])]} />
      <SiteHeader />

      <div className="mx-auto w-full max-w-[1180px] px-4 sm:px-6 lg:px-8">
        <header className="max-w-[760px] pb-8 pt-12">
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "#9CCFBB", background: "#E6F4EF" }}>
            <Checkpoint />
            <span className="font-mono text-[11px] font-medium text-[#006B45]">Pricing</span>
          </span>
          <h1 className="mt-5 text-[36px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[46px]">
            Four plans, and the numbers behind them.
          </h1>
          <p className="mt-5 text-[16px] leading-[1.65] text-[#4B5563]">
            Every limit below is the value the platform actually enforces — the same rows the API
            reads when it decides whether to accept a run. Free is a working workspace, not a
            time-limited trial.
          </p>
        </header>

        {/* ── Plan cards ─────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 gap-4 pb-10 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => (
            <article
              key={plan.code}
              className="flex flex-col rounded-[14px] border bg-white p-5"
              style={{ borderColor: plan.code === "team" ? "#9CCFBB" : "#E0E3E6" }}
            >
              <h2 className="text-[18px] font-bold tracking-[-0.01em]">{plan.name}</h2>
              <p className="mt-1 text-[13px] leading-[1.5] text-[#6B7280]">{plan.audience}</p>

              <p className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[30px] font-bold tabular-nums tracking-[-0.03em]">
                  {priceLabel(plan)}
                </span>
                {plan.priceCents !== null && plan.priceCents > 0 ? (
                  <span className="text-[13px] text-[#9CA3AF]">/mo</span>
                ) : null}
              </p>
              <p className="mt-1 text-[12px] leading-[1.5] text-[#9CA3AF]">{plan.priceNote}</p>

              <p className="mt-4 flex-1 text-[13px] leading-[1.55] text-[#4B5563]">
                {plan.description}
              </p>

              <Link
                href={plan.cta.href as Route}
                className="mt-5 inline-flex items-center justify-center rounded-[8px] px-4 py-2.5 text-[14px] font-semibold"
                style={
                  plan.code === "team"
                    ? { background: "#0B0D0F", color: "#FFFFFF" }
                    : { border: "1px solid #E0E3E6", background: "#FFFFFF", color: "#0B0D0F" }
                }
              >
                {plan.cta.label}
              </Link>
            </article>
          ))}
        </section>

        {/* ── The grid ───────────────────────────────────────────────────── */}
        <section className="pb-6">
          <h2 className="text-[22px] font-bold tracking-[-0.02em]">What each plan includes</h2>
          <p className="mt-2 max-w-[70ch] text-[14px] leading-[1.6] text-[#4B5563]">
            “Unlimited” means the plan record carries no ceiling. A dash means zero, and zero is a
            real zero — a plan showing a dash for agent teams cannot save a team, and the API says so
            with that number in the refusal.
          </p>

          <div className="mt-5 overflow-x-auto rounded-[12px] border bg-white" style={{ borderColor: "#E0E3E6" }}>
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr style={{ borderBottom: "1px solid #E0E3E6" }}>
                  <th scope="col" className="px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
                    &nbsp;
                  </th>
                  {PLANS.map((plan) => (
                    <th
                      key={plan.code}
                      scope="col"
                      className="px-4 py-3 text-[13px] font-semibold text-[#0B0D0F]"
                    >
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((row) => (
                  <tr key={row.key} style={{ borderBottom: "1px solid #ECEEEF" }}>
                    <th scope="row" className="px-4 py-3 align-top font-normal">
                      <span className="block text-[13.5px] font-medium text-[#0B0D0F]">
                        {row.label}
                      </span>
                      {row.note ? (
                        <span className="mt-0.5 block text-[12px] leading-[1.5] text-[#9CA3AF]">
                          {row.note}
                        </span>
                      ) : null}
                      {row.caveat ? (
                        <span
                          className="mt-1.5 block rounded-[6px] px-2 py-1 text-[11.5px] leading-[1.45]"
                          style={{ background: "#FFFBEB", color: "#92400E" }}
                        >
                          {/* The page states it in its own text rather than
                              relying on the imported caveat, so a reader — and
                              the claim guard — sees the qualification here. */}
                          Built, but off by default in this deployment. {row.caveat}
                        </span>
                      ) : null}
                    </th>
                    {(PLAN_CODES as readonly PlanCode[]).map((code) => {
                      const value = MATRIX_VALUES[row.key][code];
                      const included = value === true || (typeof value === "number" && value !== 0);
                      return (
                        <td
                          key={code}
                          className="px-4 py-3 align-top text-[13.5px] tabular-nums"
                          style={{
                            color: !included
                              ? "#C9CED4"
                              : NOT_YET_ON.has(row.key)
                                ? "#92400E"
                                : "#0B0D0F",
                          }}
                        >
                          {formatValue(row, value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── The honest notes ───────────────────────────────────────────── */}
        <section className="grid gap-4 pb-16 md:grid-cols-2">
          <Note title="What we do not claim">
            We publish no uptime figure and offer no SLA, because we have neither. We hold no SOC 2
            or ISO 27001 certification and no audit has been performed. We publish no latency or
            throughput benchmark, because none has been measured under conditions worth quoting. If
            any of those decides your purchase, the answer today is no — say so and we will tell you
            when it changes.
          </Note>
          <Note title="Where retention actually goes">
            Data past its window is DELETED from the database, not hidden behind a filter. There is
            no flag to flip that brings it back. A downgrade is honoured at the old window for a
            grace period before the shorter one starts deleting, so a plan change does not remove
            history before you have seen a warning.
          </Note>
          <Note title="Billing is not on the run path">
            Entitlements resolve from your billing account&apos;s plan code, which billing only ever
            writes. No quota check calls a payment provider, so a provider outage cannot stop a run.
            A past-due account is restricted; its plan code — and therefore its retention — does not
            change, because a late card must never delete a customer&apos;s data.
          </Note>
          <Note title="A shared workspace is one allowance">
            Limits resolve from the workspace&apos;s billing account, never from the person acting.
            A Pro member working inside a Free workspace gets Free&apos;s limits, at every
            enforcement point. Guests are held to their own per-member cap, and an API key inherits
            that cap rather than escaping it.
          </Note>
        </section>
      </div>

      <SiteFooter />
    </div>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border bg-white p-5" style={{ borderColor: "#E0E3E6" }}>
      <h3 className="text-[14px] font-bold tracking-[-0.01em]">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-[1.6] text-[#4B5563]">{children}</p>
    </div>
  );
}
