// ─── Pricing data model ──────────────────────────────────────────────────────
// Single source of truth shared by /pricing page and marketing preview section.
// Copy style: no hyphen characters, no full stops in visible user-facing text.

export type PlanId = "free" | "plus" | "pro" | "enterprise";
export type Billing = "monthly" | "annual";

export interface PricingPlan {
  id:          PlanId;
  name:        string;
  positioning: string;          // short tagline under the name
  monthlyPrice: number | null;  // null = custom
  annualPrice:  number | null;  // price per month when billed annually
  priceSuffix:  string;         // "per month" | "per workspace per month" | ""
  billingNoteMonthly: string;
  billingNoteAnnual:  string;
  cta:       { label: string; href: string };
  badge?:    string;            // e.g. "Best for production teams"
  highlight?: boolean;
  // Feature list for pricing cards (condensed)
  features: string[];
  // Key limits shown explicitly — things NOT included (for Plus especially)
  notIncluded?: string[];
  // Compact feature list for marketing page preview (4-6 items max)
  compactFeatures: string[];
}

export interface ComparisonRow {
  label:    string;
  free:     string;
  plus:     string;
  pro:      string;
  enterprise: string;
  isCheck?: boolean; // render as check/cross icons
}

export interface ComparisonCategory {
  name: string;
  rows: ComparisonRow[];
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export const PLANS: PricingPlan[] = [
  {
    id:          "free",
    name:        "Free",
    positioning: "For exploring AI risk control",
    monthlyPrice: 0,
    annualPrice:  0,
    priceSuffix:  "",
    billingNoteMonthly: "Forever, no card required",
    billingNoteAnnual:  "Forever, no card required",
    cta: { label: "Start free", href: "/signup" },
    features: [
      "1 workspace",
      "1 user",
      "1 environment",
      "3 prompts",
      "1 provider connection",
      "1,000 traces per month",
      "100 evaluation executions per month",
      "7 day trace retention",
      "Basic trace search",
      "Manual evaluations",
      "Prompt versioning",
      "Community support",
    ],
    notIncluded: [
      "Scheduled regressions",
      "Rollout gates",
      "Slack alerts",
      "Multi provider comparison",
      "Team roles",
      "Audit logs",
    ],
    compactFeatures: [
      "1 user",
      "1,000 traces per month",
      "100 evaluation executions per month",
      "Manual evaluations",
    ],
  },
  {
    id:          "plus",
    name:        "Plus",
    positioning: "For builders validating LLM features before they reach production",
    monthlyPrice: 29,
    annualPrice:  23,
    priceSuffix:  "per month",
    billingNoteMonthly: "Billed monthly",
    billingNoteAnnual:  "Billed annually",
    cta: { label: "Upgrade to Plus", href: "/signup?plan=plus" },
    // TODO: route to billing checkout when Stripe is integrated — for now /signup?plan=plus
    features: [
      "1 workspace",
      "Up to 2 users",
      "2 environments",
      "5 prompts",
      "3 provider connections",
      "10,000 traces per month",
      "1,000 evaluation executions per month",
      "30 day trace retention",
      "Golden traces",
      "Manual evaluations",
      "Evaluation history",
      "Candidate version comparison (single provider)",
      "Email notifications",
      "Basic provider testing (one provider at a time)",
    ],
    notIncluded: [
      "Scheduled regressions",
      "Production rollout gates",
      "Slack alerts",
      "Multi provider comparison",
      "Multi evaluation run comparison",
      "Provider recommendation",
      "Rollout decision support",
      "Team roles",
      "Audit logs",
    ],
    compactFeatures: [
      "2 users",
      "10,000 traces per month",
      "1,000 evaluation executions per month",
      "Golden traces",
      "Email notifications",
    ],
  },
  {
    id:          "pro",
    name:        "Pro",
    positioning: "For teams comparing providers, evaluating changes, and controlling production rollout risk",
    monthlyPrice: 499,
    annualPrice:  399,
    priceSuffix:  "per workspace per month",
    billingNoteMonthly: "Billed monthly",
    billingNoteAnnual:  "Billed annually",
    cta: { label: "Start Pro", href: "/signup?plan=pro" },
    // TODO: route to billing checkout when Stripe is integrated — for now /signup?plan=pro
    badge:     "Best for production teams",
    highlight: true,
    features: [
      "3 workspaces",
      "Up to 10 users",
      "Production environment controls",
      "Unlimited prompts (fair use)",
      "Unlimited environments (fair use)",
      "10 provider connections",
      "250,000 traces per month",
      "25,000 evaluation executions per month",
      "90 day trace retention",
      "Scheduled regressions",
      "Rollout gates",
      "Slack alerts",
      "Email alerts",
      "Multi provider trace comparison",
      "Multi provider evaluation comparison",
      "Multi evaluation run comparison",
      "Provider recommendation",
      "Quality latency cost comparison",
      "Production decision reports",
      "Rollout decision support",
      "Regression history",
      "Trace debugging",
      "RAG and intermediate call tracing",
      "Team roles",
      "Audit trail",
      "Usage alerts",
      "Priority support",
    ],
    compactFeatures: [
      "10 users",
      "250,000 traces per month",
      "25,000 evaluation executions per month",
      "Multi provider comparison",
      "Scheduled regressions",
      "Rollout gates",
    ],
  },
  {
    id:          "enterprise",
    name:        "Enterprise",
    positioning: "For organizations needing governance, custom policies, and private controls",
    monthlyPrice: null,
    annualPrice:  null,
    priceSuffix:  "",
    billingNoteMonthly: "Annual or quarterly contracts",
    billingNoteAnnual:  "Annual or quarterly contracts",
    cta: { label: "Talk to sales", href: "/book-demo" },
    features: [
      "Unlimited workspaces",
      "Custom users",
      "Custom trace volume",
      "Custom evaluation volume",
      "Custom retention",
      "SSO and SAML",
      "Advanced RBAC",
      "Audit logs",
      "Data residency options",
      "Private deployment option",
      "Enterprise gateway mode",
      "Custom rollout policies",
      "Custom provider policies",
      "Organization wide comparison reports",
      "Custom scoring policies",
      "Compliance exports",
      "Governance level decision history",
      "Advanced alert routing",
      "Security review support",
      "Custom contracts and SLA",
      "Dedicated onboarding",
    ],
    compactFeatures: [
      "Custom volume",
      "SSO and SAML",
      "Advanced RBAC",
      "Private deployment",
      "SLA",
    ],
  },
];

// ─── Feature comparison table ─────────────────────────────────────────────────

export const COMPARISON_CATEGORIES: ComparisonCategory[] = [
  {
    name: "Core platform",
    rows: [
      { label: "Workspaces",               free: "1",       plus: "1",       pro: "3",         enterprise: "Custom" },
      { label: "Users",                    free: "1",       plus: "2",       pro: "10",        enterprise: "Custom" },
      { label: "Prompts",                  free: "3",       plus: "5",       pro: "Fair use",  enterprise: "Custom" },
      { label: "Environments",             free: "1",       plus: "2",       pro: "Fair use",  enterprise: "Custom" },
      { label: "Provider connections",     free: "1",       plus: "3",       pro: "10",        enterprise: "Custom" },
    ],
  },
  {
    name: "Tracing",
    rows: [
      { label: "Monthly traces",           free: "1,000",   plus: "10,000",  pro: "250,000",   enterprise: "Custom" },
      { label: "Trace retention",          free: "7 days",  plus: "30 days", pro: "90 days",   enterprise: "Custom" },
      { label: "Trace search",             free: "Basic",   plus: "Basic",   pro: "Full",      enterprise: "Advanced" },
      { label: "RAG and intermediate call tracing", free: "—", plus: "—",   pro: "✓",         enterprise: "✓" },
    ],
  },
  {
    name: "Evaluations",
    rows: [
      { label: "Monthly evaluation executions", free: "100", plus: "1,000", pro: "25,000",    enterprise: "Custom" },
      { label: "Manual evaluations",       free: "✓",       plus: "✓",       pro: "✓",         enterprise: "✓" },
      { label: "Golden traces",            free: "—",       plus: "✓",       pro: "✓",         enterprise: "✓" },
      { label: "Evaluation history",       free: "—",       plus: "✓",       pro: "✓",         enterprise: "✓" },
      { label: "Candidate comparison",     free: "—",       plus: "✓",       pro: "✓",         enterprise: "✓" },
      { label: "Evaluation comparison",    free: "—",       plus: "—",       pro: "✓",         enterprise: "✓" },
    ],
  },
  {
    name: "Regressions",
    rows: [
      { label: "Scheduled regressions",    free: "—",       plus: "—",       pro: "✓",         enterprise: "Custom" },
      { label: "Regression history",       free: "—",       plus: "—",       pro: "✓",         enterprise: "✓" },
    ],
  },
  {
    name: "Rollout control",
    rows: [
      { label: "Rollout gates",            free: "—",       plus: "Preview", pro: "✓",         enterprise: "Custom policies" },
      { label: "Production environment controls", free: "—", plus: "—",     pro: "✓",         enterprise: "✓" },
      { label: "Prompt versioning",        free: "✓",       plus: "✓",       pro: "✓",         enterprise: "✓" },
    ],
  },
  {
    name: "Alerts",
    rows: [
      { label: "Email alerts",             free: "—",       plus: "✓",       pro: "✓",         enterprise: "✓" },
      { label: "Slack alerts",             free: "—",       plus: "—",       pro: "✓",         enterprise: "✓" },
      { label: "Usage alerts",             free: "—",       plus: "—",       pro: "✓",         enterprise: "✓" },
    ],
  },
  {
    name: "Provider and evaluation comparison",
    rows: [
      { label: "Basic provider testing",               free: "—",   plus: "Limited", pro: "✓",                    enterprise: "✓" },
      { label: "Multi provider trace comparison",      free: "—",   plus: "—",       pro: "✓",                    enterprise: "Advanced" },
      { label: "Multi provider evaluation comparison", free: "—",   plus: "—",       pro: "✓",                    enterprise: "Advanced" },
      { label: "Multi evaluation run comparison",      free: "—",   plus: "—",       pro: "✓",                    enterprise: "Advanced" },
      { label: "Provider recommendation",              free: "—",   plus: "—",       pro: "✓",                    enterprise: "Custom policies" },
      { label: "Quality latency cost comparison",      free: "—",   plus: "Preview", pro: "✓",                    enterprise: "Advanced" },
      { label: "Production decision report",           free: "—",   plus: "—",       pro: "✓",                    enterprise: "Governance reports" },
      { label: "Rollout decision support",             free: "—",   plus: "—",       pro: "✓",                    enterprise: "Custom policies" },
    ],
  },
  {
    name: "Collaboration",
    rows: [
      { label: "Team roles",               free: "—",       plus: "—",       pro: "✓",         enterprise: "Advanced" },
      { label: "Audit trail",              free: "—",       plus: "—",       pro: "✓",         enterprise: "Advanced" },
    ],
  },
  {
    name: "Security",
    rows: [
      { label: "SSO and SAML",             free: "—",       plus: "—",       pro: "—",         enterprise: "✓" },
      { label: "Advanced RBAC",            free: "—",       plus: "—",       pro: "—",         enterprise: "✓" },
      { label: "Audit logs",               free: "—",       plus: "—",       pro: "—",         enterprise: "✓" },
      { label: "Private deployment",       free: "—",       plus: "—",       pro: "—",         enterprise: "✓" },
      { label: "Custom retention",         free: "—",       plus: "—",       pro: "—",         enterprise: "✓" },
    ],
  },
  {
    name: "Support",
    rows: [
      { label: "Support level",            free: "Community", plus: "Email", pro: "Priority",  enterprise: "Dedicated" },
    ],
  },
];

// ─── FAQ ──────────────────────────────────────────────────────────────────────

export interface FaqItem {
  q: string;
  a: string;
}

export const PRICING_FAQ: FaqItem[] = [
  {
    q: "Can I start for free",
    a: "Yes — the Free plan is available forever with no card required. It includes tracing, manual evaluations, and prompt versioning to help you explore VectorBea before committing",
  },
  {
    q: "What is an evaluation execution",
    a: "An evaluation execution is one test case evaluated against one prompt version or provider. Running 100 traces through a candidate prompt counts as 100 evaluation executions",
  },
  {
    q: "Why are scheduled regressions only in Pro",
    a: "Scheduled regressions are a production control. They run recurring quality checks against baseline trace sets to catch drift before users do. This capability belongs in Pro alongside rollout gates and audit trails",
  },
  {
    q: "Why is multi provider comparison only in Pro",
    a: "Side by side provider comparison, evaluation diffs, quality latency cost analysis, and rollout decision support are production controls. Plus supports basic provider testing — connecting providers and running manual evaluations one at a time. Full comparison and decision reporting begin in Pro",
  },
  {
    q: "Can I use my own provider keys",
    a: "Yes — VectorBea works with your own provider credentials. Your keys are encrypted at rest and never exposed in logs or traces",
  },
  {
    q: "Do you store prompts and outputs",
    a: "Traces including prompt inputs and LLM outputs are stored for the duration of your plan's retention period. Enterprise customers can configure custom retention and data residency policies",
  },
  {
    q: "Can VectorBea block unsafe rollouts",
    a: "Yes — rollout gates in Pro can block candidate prompt or model versions when evaluation checks fail or confidence is below threshold. Enterprise plans support custom rollout policies",
  },
  {
    q: "What happens when I exceed my limits",
    a: "VectorBea shows usage alerts before you hit limits. Once reached, additional traces or evaluation executions are queued but not dropped. You can upgrade or add capacity as needed",
  },
  {
    q: "Can I change plans later",
    a: "Yes — you can upgrade at any time. Downgrades take effect at the end of your billing period",
  },
  {
    q: "Do you support private deployment",
    a: "Private deployment is available on Enterprise plans. It includes VPC deployment options, data residency controls, and a dedicated onboarding partner",
  },
  {
    q: "Do you offer annual billing",
    a: "Yes — annual billing saves 20 percent compared to monthly. Toggle between monthly and annual on this page to see the difference",
  },
];

// ─── Production boundary features ────────────────────────────────────────────

export const PRODUCTION_BOUNDARY = [
  {
    title: "Scheduled regressions",
    body:  "Run recurring checks before quality drifts",
  },
  {
    title: "Rollout gates",
    body:  "Block risky prompt and model changes",
  },
  {
    title: "Production alerts",
    body:  "Notify teams when behavior degrades",
  },
  {
    title: "Audit trail",
    body:  "See who changed what and when",
  },
];

// ─── Add-ons ──────────────────────────────────────────────────────────────────

export const ADD_ONS = [
  {
    title:   "Extra traces",
    body:    "100,000 additional traces per month",
    pricing: "Contact us",
  },
  {
    title:   "Extra evaluations",
    body:    "10,000 additional evaluation executions per month",
    pricing: "Contact us",
  },
  {
    title:   "Extended retention",
    body:    "Add 30 days of trace retention",
    pricing: "Available on paid plans",
  },
  {
    title:   "LLM judge capacity",
    body:    "Additional judged evaluation capacity",
    pricing: "Contact us",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatPrice(plan: PricingPlan, billing: Billing): string {
  const price = billing === "annual" ? plan.annualPrice : plan.monthlyPrice;
  if (price === null) return "Custom";
  if (price === 0)    return "$0";
  return `$${price}`;
}
