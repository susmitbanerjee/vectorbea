export type PlanId = "free" | "plus" | "pro" | "enterprise";
export type Billing = "monthly" | "annual";

export interface PricingPlan {
  id: PlanId;
  name: string;
  positioning: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  priceSuffix: string;
  billingNoteMonthly: string;
  billingNoteAnnual: string;
  cta: { label: string; href: string };
  badge?: string;
  highlight?: boolean;
  features: string[];
  notIncluded?: string[];
  compactFeatures: string[];
}

export interface ComparisonRow {
  label: string;
  free: string;
  plus: string;
  pro: string;
  enterprise: string;
}

export interface ComparisonCategory {
  name: string;
  rows: ComparisonRow[];
}

export const PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    positioning: "Explore AI risk control",
    monthlyPrice: 0,
    annualPrice: 0,
    priceSuffix: "",
    billingNoteMonthly: "Forever, no card required",
    billingNoteAnnual: "Forever, no card required",
    cta: { label: "Start free", href: "/signup" },
    features: [
      "1 workspace",
      "1 user",
      "1 environment",
      "3 prompts",
      "1 provider connection",
      "1,000 traces per month",
      "100 evaluation executions per month",
      "7 day retention",
      "Basic tracing",
      "Manual baseline evaluations",
    ],
    notIncluded: [
      "Golden traces",
      "Behavioral evaluations",
      "Provider Arena",
      "Scheduled regressions",
      "Rollout gates",
      "Slack alerts",
    ],
    compactFeatures: [
      "1,000 traces",
      "100 evaluation executions",
      "Manual baseline evaluations",
      "7 day retention",
    ],
  },
  {
    id: "plus",
    name: "Plus",
    positioning: "Validate LLM features before production",
    monthlyPrice: 29,
    annualPrice: 23,
    priceSuffix: "per month",
    billingNoteMonthly: "Billed monthly",
    billingNoteAnnual: "Billed annually",
    cta: { label: "Upgrade to Plus", href: "/signup?plan=plus" },
    features: [
      "1 workspace",
      "2 users",
      "2 environments",
      "5 prompts",
      "3 provider connections",
      "10,000 traces per month",
      "1,000 evaluation executions per month",
      "1,000 provider executions per month",
      "1,000 judge executions per month",
      "30 day retention",
      "Golden traces",
      "Basic candidate comparison",
      "Email notifications",
      "Basic provider testing",
    ],
    notIncluded: [
      "Behavioral evaluations",
      "Provider Arena",
      "Scheduled regressions",
      "Rollout gates",
      "Slack alerts",
      "Review queue",
      "Audit trail",
    ],
    compactFeatures: [
      "10,000 traces",
      "1,000 evaluation executions",
      "Golden traces",
      "Email notifications",
      "Basic provider testing",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    positioning: "Control production LLM risk",
    monthlyPrice: 499,
    annualPrice: 399,
    priceSuffix: "per workspace per month",
    billingNoteMonthly: "Billed monthly",
    billingNoteAnnual: "Billed annually",
    cta: { label: "Start Pro", href: "/signup?plan=pro" },
    badge: "Best for production teams",
    highlight: true,
    features: [
      "3 workspaces",
      "10 users",
      "High prompt capacity",
      "High environment capacity",
      "10 provider connections",
      "250,000 traces per month",
      "25,000 evaluation executions per month",
      "25,000 provider executions per month",
      "10,000 judge executions per month",
      "100 scheduled regressions per month",
      "50 Provider Arena runs per month",
      "90 day retention",
      "Behavioral evaluations",
      "Provider Arena",
      "Scheduled regressions",
      "Rollout gates",
      "Slack alerts",
      "Multi provider comparison",
      "Multi evaluation comparison",
      "Review queue",
      "Audit trail",
      "Production decision reports",
    ],
    compactFeatures: [
      "Behavioral evaluations",
      "Provider Arena",
      "Scheduled regressions",
      "Rollout gates",
      "Audit trail",
      "Production decision reports",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    positioning: "Govern AI behavior at scale",
    monthlyPrice: null,
    annualPrice: null,
    priceSuffix: "",
    billingNoteMonthly: "Custom contract",
    billingNoteAnnual: "Custom contract",
    cta: { label: "Talk to sales", href: "/book-demo" },
    features: [
      "Custom workspaces",
      "Custom users",
      "Custom trace volume",
      "Custom evaluation volume",
      "Custom retention",
      "SSO",
      "Advanced RBAC",
      "Locked rubrics",
      "Custom policies",
      "Audit ready reports",
      "PII redaction",
      "Private deployment",
      "Data residency",
      "SLA",
    ],
    compactFeatures: [
      "SSO",
      "Advanced RBAC",
      "Locked rubrics",
      "Private deployment",
      "Data residency",
      "SLA",
    ],
  },
];

export const COMPARISON_CATEGORIES: ComparisonCategory[] = [
  {
    name: "Core platform",
    rows: [
      { label: "Workspaces", free: "1", plus: "1", pro: "3", enterprise: "Custom" },
      { label: "Users", free: "1", plus: "2", pro: "10", enterprise: "Custom" },
      { label: "Prompts", free: "3", plus: "5", pro: "High", enterprise: "Custom" },
      { label: "Environments", free: "1", plus: "2", pro: "High", enterprise: "Custom" },
      { label: "Provider connections", free: "1", plus: "3", pro: "10", enterprise: "Custom" },
    ],
  },
  {
    name: "Usage limits",
    rows: [
      { label: "Monthly traces", free: "1,000", plus: "10,000", pro: "250,000", enterprise: "Custom" },
      { label: "Evaluation executions", free: "100", plus: "1,000", pro: "25,000", enterprise: "Custom" },
      { label: "Provider executions", free: "0", plus: "1,000", pro: "25,000", enterprise: "Custom" },
      { label: "Judge executions", free: "100", plus: "1,000", pro: "10,000", enterprise: "Custom" },
      { label: "Scheduled regressions", free: "0", plus: "0", pro: "100", enterprise: "Custom" },
      { label: "Provider Arena runs", free: "0", plus: "0", pro: "50", enterprise: "Custom" },
      { label: "Retention", free: "7 days", plus: "30 days", pro: "90 days", enterprise: "Custom" },
    ],
  },
  {
    name: "Evaluations",
    rows: [
      { label: "Manual baseline evaluations", free: "Yes", plus: "Yes", pro: "Yes", enterprise: "Yes" },
      { label: "Golden traces", free: "No", plus: "Yes", pro: "Yes", enterprise: "Yes" },
      { label: "Behavioral evaluations", free: "No", plus: "No", pro: "Yes", enterprise: "Yes" },
      { label: "Basic candidate comparison", free: "No", plus: "Yes", pro: "Yes", enterprise: "Yes" },
      { label: "Multi evaluation comparison", free: "No", plus: "No", pro: "Yes", enterprise: "Yes" },
    ],
  },
  {
    name: "Production controls",
    rows: [
      { label: "Scheduled regressions", free: "No", plus: "No", pro: "Yes", enterprise: "Yes" },
      { label: "Rollout gates", free: "No", plus: "No", pro: "Yes", enterprise: "Custom policies" },
      { label: "Slack alerts", free: "No", plus: "No", pro: "Yes", enterprise: "Yes" },
      { label: "Review queue", free: "No", plus: "No", pro: "Yes", enterprise: "Yes" },
      { label: "Audit trail", free: "No", plus: "No", pro: "Yes", enterprise: "Advanced" },
    ],
  },
  {
    name: "Provider decisioning",
    rows: [
      { label: "Basic provider testing", free: "No", plus: "Limited", pro: "Yes", enterprise: "Yes" },
      { label: "Provider Arena", free: "No", plus: "No", pro: "Yes", enterprise: "Advanced" },
      { label: "Multi provider comparison", free: "No", plus: "No", pro: "Yes", enterprise: "Advanced" },
      { label: "Production decision reports", free: "No", plus: "No", pro: "Yes", enterprise: "Governance" },
    ],
  },
  {
    name: "Enterprise governance",
    rows: [
      { label: "SSO", free: "No", plus: "No", pro: "No", enterprise: "Yes" },
      { label: "Advanced RBAC", free: "No", plus: "No", pro: "No", enterprise: "Yes" },
      { label: "Locked rubrics", free: "No", plus: "No", pro: "No", enterprise: "Yes" },
      { label: "PII redaction", free: "No", plus: "No", pro: "No", enterprise: "Yes" },
      { label: "Private deployment", free: "No", plus: "No", pro: "No", enterprise: "Yes" },
      { label: "Data residency", free: "No", plus: "No", pro: "No", enterprise: "Yes" },
    ],
  },
];

export interface FaqItem {
  q: string;
  a: string;
}

export const PRICING_FAQ: FaqItem[] = [
  {
    q: "Can I start for free",
    a: "Yes, the Free plan is available without a card and is designed for early tracing and manual baseline checks",
  },
  {
    q: "What is an evaluation execution",
    a: "One dataset item evaluated against one prompt version or provider counts as one evaluation execution",
  },
  {
    q: "Why is Provider Arena only on Pro",
    a: "Provider Arena is a production decision workflow with multi provider execution, rubric judging, and rollout oriented reporting",
  },
  {
    q: "What happens when I exceed my limits",
    a: "VectorBea warns before quota thresholds and returns a clear quota response once a limit is reached",
  },
  {
    q: "Can I change plans later",
    a: "Yes, you can upgrade at any time and move to Enterprise through a sales process when governance needs grow",
  },
  {
    q: "Do you offer annual billing",
    a: "Yes, Plus and Pro both have annual pricing with lower monthly effective cost",
  },
];

export const PRODUCTION_BOUNDARY = [
  {
    title: "Scheduled regressions",
    body: "Run recurring checks before quality drifts",
  },
  {
    title: "Rollout gates",
    body: "Block risky prompt and model changes",
  },
  {
    title: "Production alerts",
    body: "Notify teams when behavior degrades",
  },
  {
    title: "Audit trail",
    body: "See who changed what and when",
  },
];

export const ADD_ONS = [
  {
    title: "Extra traces",
    body: "Additional trace capacity for high traffic workspaces",
    pricing: "Available on paid plans",
  },
  {
    title: "Extra evaluation executions",
    body: "Additional evaluation capacity for larger validation loops",
    pricing: "Contact us",
  },
  {
    title: "Extra judge executions",
    body: "Additional rubric scoring capacity for behavioral work",
    pricing: "Contact us",
  },
  {
    title: "Extended retention",
    body: "More retention for trace and evaluation history",
    pricing: "Contact us",
  },
  {
    title: "Provider Arena capacity",
    body: "More multi provider decision runs for larger teams",
    pricing: "Contact us",
  },
];

export function formatPrice(plan: PricingPlan, billing: Billing): string {
  const price = billing === "annual" ? plan.annualPrice : plan.monthlyPrice;
  if (price === null) return "Custom";
  if (price === 0) return "$0";
  return `$${price}`;
}
