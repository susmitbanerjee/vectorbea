import "server-only";

import { appQuery, appQueryOne } from "./app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   BILLING, FOR THE SETTINGS SCREEN

   EVERY PRICE COMES FROM `plan_prices`
   Nothing here or in the component hardcodes an amount. The server returns minor
   units and a currency code; the client formats them with `Intl`. A price
   rendered from a constant is a price that disagrees with the invoice the first
   time somebody re-prices, and the customer believes the screen.

   READS ONLY OUR SCHEMA
   No call here reaches Stripe or Razorpay. That is the §3 rule: local
   entitlements are the source of truth and a provider outage must not stop
   anything — including this page loading. Webhooks push provider state into
   these tables; this reads it back.

   AND IT IS BEHIND A FLAG THAT IS OFF
   `billing` defaults to false because there is no bank account. The data path is
   complete and tested; what is gated is showing a customer a checkout that would
   take no money.
══════════════════════════════════════════════════════════════════════════════ */

export interface BillingPlanOption {
  planCode: string;
  planName: string;
  /** Minor units — cents, paise. Formatted by the client, never here. */
  unitAmountMinor: number;
  currency: string;
  interval: string;
  /** Whether the amount includes tax. India quotes inclusive; the US does not. */
  taxBehavior: string;
  isCurrent: boolean;
}

export interface BillingSubscription {
  planCode: string;
  status: string;
  quantity: number;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  currency: string;
  totalMinor: number;
  taxMinor: number;
  status: string;
  issuedAt: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

export interface BillingPaymentMethod {
  id: string;
  kind: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  label: string | null;
  isDefault: boolean;
}

export interface BillingDunning {
  stage: string;
  daysPastDue: number;
  /** When the next dunning step happens. A warning without a date is not one. */
  nextStepAt: string | null;
  restricted: boolean;
}

export interface BillingPanel {
  accountId: string;
  currency: string;
  /** False until a provider is configured — the UI says so rather than pretending. */
  providerLive: boolean;
  subscription: BillingSubscription | null;
  plans: BillingPlanOption[];
  invoices: BillingInvoice[];
  paymentMethods: BillingPaymentMethod[];
  dunning: BillingDunning;
}

export async function getBillingPanel(workspaceId: string): Promise<BillingPanel | null> {
  // A deployment whose database predates V063 has none of this. Null degrades
  // the section rather than 500-ing the settings page around it.
  const present = await appQueryOne<{ one: number }>(
    `SELECT 1 AS one FROM pg_tables WHERE tablename = 'plan_prices' LIMIT 1`,
    [],
  );
  if (!present) return null;

  const account = await appQueryOne<{
    id: string;
    plan_code: string;
    provider: string;
    currency: string | null;
    country: string | null;
  }>(
    `SELECT b.id, b.plan_code, b.provider, b.currency, b.country
       FROM workspaces w JOIN billing_accounts b ON b.id = w.billing_account_id
      WHERE w.id = $1::uuid`,
    [workspaceId],
  );
  if (!account) return null;

  // Currency is decided at signup; India defaults to INR because Razorpay
  // settles in INR and a rupee price is a decision rather than a conversion.
  const currency = account.currency ?? (account.country === "IN" ? "INR" : "USD");

  const priceRows = await appQuery<{
    plan_code: string;
    plan_name: string;
    unit_amount_minor: string;
    currency: string;
    billing_interval: string;
    tax_behavior: string;
  }>(
    `SELECT p.plan_code, pl.name AS plan_name, p.unit_amount_minor::text,
            p.currency, p.billing_interval, p.tax_behavior
       FROM plan_prices p
       JOIN plans pl ON pl.code = p.plan_code
      WHERE p.currency = $1 AND p.billing_interval = 'month' AND p.active
        AND pl.is_public AND pl.archived_at IS NULL
      ORDER BY pl.sort_order`,
    [currency],
  );

  const sub = await appQueryOne<{
    plan_code: string;
    status: string;
    quantity: number;
    trial_end: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  }>(
    `SELECT plan_code, status, quantity, trial_end, current_period_end, cancel_at_period_end
       FROM subscriptions
      WHERE billing_account_id = $1::uuid
        AND status IN ('trialing','active','past_due','incomplete')
      ORDER BY created_at DESC LIMIT 1`,
    [account.id],
  );

  const invoices = await appQuery<{
    id: string;
    number: string | null;
    currency: string;
    total_minor: string;
    tax_minor: string;
    status: string;
    issued_at: string | null;
    hosted_url: string | null;
    pdf_url: string | null;
  }>(
    `SELECT id, number, currency, total_minor::text, tax_minor::text, status,
            issued_at, hosted_url, pdf_url
       FROM invoices WHERE billing_account_id = $1::uuid
      ORDER BY COALESCE(issued_at, created_at) DESC LIMIT 24`,
    [account.id],
  );

  const methods = await appQuery<{
    id: string;
    kind: string;
    brand: string | null;
    last4: string | null;
    exp_month: number | null;
    exp_year: number | null;
    display_label: string | null;
    is_default: boolean;
  }>(
    `SELECT id, kind, brand, last4, exp_month, exp_year, display_label, is_default
       FROM payment_methods
      WHERE billing_account_id = $1::uuid AND removed_at IS NULL
      ORDER BY is_default DESC, created_at DESC`,
    [account.id],
  );

  const dunning = await appQueryOne<{
    stage: string;
    days_past_due: number;
    next_step_at: string | null;
    restricted: boolean;
  }>(
    `SELECT stage, days_past_due, next_step_at, restricted FROM billing_dunning_state($1::uuid)`,
    [account.id],
  );

  return {
    accountId: account.id,
    currency,
    // 'noop' is the default and means no money can move. The UI reads this and
    // says so, rather than rendering a subscribe button that does nothing visible.
    providerLive: account.provider !== "noop",
    subscription: sub
      ? {
          planCode: sub.plan_code,
          status: sub.status,
          quantity: sub.quantity,
          trialEnd: sub.trial_end,
          currentPeriodEnd: sub.current_period_end,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        }
      : null,
    plans: priceRows.map((r) => ({
      planCode: r.plan_code,
      planName: r.plan_name,
      // BIGINT arrives from `pg` as a string. Converted deliberately: a string
      // comparison would sort "9900" below "499" in any table that ranks plans.
      unitAmountMinor: Number(r.unit_amount_minor),
      currency: r.currency,
      interval: r.billing_interval,
      taxBehavior: r.tax_behavior,
      isCurrent: r.plan_code === account.plan_code,
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      currency: i.currency,
      totalMinor: Number(i.total_minor),
      taxMinor: Number(i.tax_minor),
      status: i.status,
      issuedAt: i.issued_at,
      hostedUrl: i.hosted_url,
      pdfUrl: i.pdf_url,
    })),
    paymentMethods: methods.map((m) => ({
      id: m.id,
      kind: m.kind,
      brand: m.brand,
      last4: m.last4,
      expMonth: m.exp_month,
      expYear: m.exp_year,
      label: m.display_label,
      isDefault: m.is_default,
    })),
    dunning: dunning
      ? {
          stage: dunning.stage,
          daysPastDue: dunning.days_past_due,
          nextStepAt: dunning.next_step_at,
          restricted: dunning.restricted,
        }
      : { stage: "current", daysPastDue: 0, nextStepAt: null, restricted: false },
  };
}
