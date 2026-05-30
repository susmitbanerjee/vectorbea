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
    positioning: "Explore AI agent automation",
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
      "3 workflows",
      "1 worker connection",
      "1,000 agent runs per month",
      "10,000 events per month",
      "7 day run retention",
      "Basic timeline view",
      "Manual approval gates",
    ],
    notIncluded: [
      "Scheduled workflows",
      "Run replay",
      "Slack notifications",
      "Approval policies",
      "Audit trail",
    ],
    compactFeatures: [
      "1,000 agent runs",
      "10,000 events",
      "Manual approval gates",
      "7 day retention",
    ],
  },
  {
    id: "plus",
    name: "Plus",
    positioning: "Automate AI workflows before production",
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
      "5 workflows",
      "3 worker connections",
      "10,000 agent runs per month",
      "100,000 events per month",
      "30 day run retention",
      "Scheduled workflows",
      "Run timeline and flow view",
      "Email notifications",
    ],
    notIncluded: [
      "Run replay",
      "Approval policies",
      "Rollout controls",
      "Slack notifications",
      "Audit trail",
    ],
    compactFeatures: [
      "10,000 agent runs",
      "Scheduled workflows",
      "Run timeline and flow view",
      "Email notifications",
      "30 day retention",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    positioning: "Control production AI agent risk",
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
      "High workflow capacity",
      "High environment capacity",
      "10 worker connections",
      "250,000 agent runs per month",
      "10M events per month",
      "90 day run retention",
      "Run replay and checkpoints",
      "Approval policies",
      "Rollout controls",
      "Slack notifications",
      "Multi-agent flow view",
      "Audit trail",
      "Production decision reports",
    ],
    compactFeatures: [
      "Run replay and checkpoints",
      "Approval policies",
      "Rollout controls",
      "Audit trail",
      "Production decision reports",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    positioning: "Scale AI agent operations across your org",
    monthlyPrice: null,
    annualPrice: null,
    priceSuffix: "",
    billingNoteMonthly: "Custom contract",
    billingNoteAnnual: "Custom contract",
    cta: { label: "Talk to sales", href: "/book-demo" },
    features: [
      "Custom workspaces",
      "Custom users",
      "Custom run volume",
      "Custom event volume",
      "Custom retention",
      "SSO",
      "Advanced RBAC",
      "Custom approval policies",
      "Locked workflow policies",
      "Audit-ready reports",
      "PII redaction",
      "Private deployment",
      "Data residency",
      "SLA",
    ],
    compactFeatures: [
      "SSO",
      "Advanced RBAC",
      "Locked workflow policies",
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
      { label: "Workflows", free: "3", plus: "5", pro: "High", enterprise: "Custom" },
      { label: "Environments", free: "1", plus: "2", pro: "High", enterprise: "Custom" },
      { label: "Worker connections", free: "1", plus: "3", pro: "10", enterprise: "Custom" },
    ],
  },
  {
    name: "Usage limits",
    rows: [
      { label: "Monthly agent runs", free: "1,000", plus: "10,000", pro: "250,000", enterprise: "Custom" },
      { label: "Monthly events", free: "10,000", plus: "100,000", pro: "10M", enterprise: "Custom" },
      { label: "Scheduled workflow triggers", free: "0", plus: "10", pro: "100", enterprise: "Custom" },
      { label: "Run retention", free: "7 days", plus: "30 days", pro: "90 days", enterprise: "Custom" },
    ],
  },
  {
    name: "Run observability",
    rows: [
      { label: "Timeline view", free: "Yes", plus: "Yes", pro: "Yes", enterprise: "Yes" },
      { label: "Flow view", free: "No", plus: "Yes", pro: "Yes", enterprise: "Yes" },
      { label: "Run replay and checkpoints", free: "No", plus: "No", pro: "Yes", enterprise: "Yes" },
      { label: "Artifact storage", free: "No", plus: "Limited", pro: "Yes", enterprise: "Custom" },
    ],
  },
  {
    name: "Production controls",
    rows: [
      { label: "Manual approval gates", free: "Yes", plus: "Yes", pro: "Yes", enterprise: "Yes" },
      { label: "Approval policies", free: "No", plus: "No", pro: "Yes", enterprise: "Custom policies" },
      { label: "Rollout controls", free: "No", plus: "No", pro: "Yes", enterprise: "Yes" },
      { label: "Slack notifications", free: "No", plus: "No", pro: "Yes", enterprise: "Yes" },
      { label: "Audit trail", free: "No", plus: "No", pro: "Yes", enterprise: "Advanced" },
    ],
  },
  {
    name: "Enterprise controls",
    rows: [
      { label: "SSO", free: "No", plus: "No", pro: "No", enterprise: "Yes" },
      { label: "Advanced RBAC", free: "No", plus: "No", pro: "No", enterprise: "Yes" },
      { label: "Locked workflow policies", free: "No", plus: "No", pro: "No", enterprise: "Yes" },
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
    a: "Yes, the Free plan is available without a card and is designed for exploring agent workflows and running manual approval tests.",
  },
  {
    q: "What counts as an agent run",
    a: "One triggered workflow execution counts as one agent run, regardless of how many agents or steps are involved.",
  },
  {
    q: "Why is run replay only on Pro",
    a: "Run replay requires checkpoint storage and event replay infrastructure that adds storage and compute costs.",
  },
  {
    q: "What happens when I exceed my limits",
    a: "Vectorbea warns before quota thresholds and returns a clear quota response once a limit is reached.",
  },
  {
    q: "Can I change plans later",
    a: "Yes, you can upgrade at any time and move to Enterprise through a sales process when organizational needs grow.",
  },
  {
    q: "Do you offer annual billing",
    a: "Yes, Plus and Pro both have annual pricing with a lower monthly effective cost.",
  },
];

export const PRODUCTION_BOUNDARY = [
  {
    title: "Scheduled workflows",
    body: "Trigger agents on a cron schedule automatically",
  },
  {
    title: "Approval policies",
    body: "Gate high-risk tool calls with human review",
  },
  {
    title: "Rollout controls",
    body: "Safely promote workflow versions to production",
  },
  {
    title: "Audit trail",
    body: "See who changed what and when across every run",
  },
];

export const ADD_ONS = [
  {
    title: "Extra agent runs",
    body: "Additional run capacity for high-volume workspaces",
    pricing: "Available on paid plans",
  },
  {
    title: "Extra event volume",
    body: "Additional event capacity for dense multi-agent workflows",
    pricing: "Contact us",
  },
  {
    title: "Extended retention",
    body: "More retention for run history, events, and artifacts",
    pricing: "Contact us",
  },
  {
    title: "Extra worker connections",
    body: "More concurrent worker slots for large teams",
    pricing: "Contact us",
  },
];

export function formatPrice(plan: PricingPlan, billing: Billing): string {
  const price = billing === "annual" ? plan.annualPrice : plan.monthlyPrice;
  if (price === null) return "Custom";
  if (price === 0) return "$0";
  return `$${price}`;
}
