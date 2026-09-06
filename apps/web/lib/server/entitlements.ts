import "server-only";

import { appQuery, appQueryOne } from "./app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   PLAN ENTITLEMENTS, FROM THE WEB SIDE

   THE GOVERNING RULE
   ENTITLEMENTS RESOLVE FROM THE WORKSPACE'S BILLING ACCOUNT, NEVER FROM THE
   REQUESTING USER'S PLAN. A Pro member acting inside a Free workspace gets Free
   limits. Every function here takes a workspaceId and none takes a userId,
   except `requireSeatForNewMember`, which needs one to answer "is this person
   already paid for" — and answers it by looking up their membership of THAT
   ACCOUNT, never their own plan.

   WHY THIS CALLS SQL FUNCTIONS AND DOES NOT REIMPLEMENT THE MERGE
   `resolve_entitlements(workspace_id)` in V060 is the definition: plan rows as
   the base, live account overrides on top, keyed by entitlement. The Kotlin
   resolver calls it and so does this file. Writing the join twice would be two
   opinions about which plan governs a workspace, and the one that drifts is the
   one nobody has a test for — which, between a Kotlin service with an
   integration suite and a Next.js route handler, is not hard to predict.

   So: no SELECT here touches `plans` or `plan_entitlements` directly. Two
   surfaces enforce plans on this side — inviting a member and changing a role —
   and both go through `requireSeatForNewMember`.

   WHY THERE IS NO CACHE
   The Kotlin resolver caches because it is called on every triggered run. These
   routes are human-paced: an invitation is a person clicking a button. A cache
   would add an invalidation problem to a path that runs a few times a day.
══════════════════════════════════════════════════════════════════════════════ */

export type EntitlementKind = "quota" | "limit" | "feature" | "setting";

export interface Entitlement {
  key: string;
  kind: EntitlementKind;
  scope: "account" | "workspace";
  period: string | null;
  /** `-1` means unlimited for a quota or a limit. */
  intValue: number | null;
  boolValue: boolean | null;
  numValue: number | null;
  textValue: string | null;
  /** "plan" or "override" — rendered so a negotiated deviation is visible. */
  source: string;
}

export interface PlanSummary {
  code: string;
  name: string;
  priceCents: number | null;
  currency: string;
  billingInterval: string;
  priceModel: string;
  status: string;
  upgradeTo: string | null;
  upgradeToName: string | null;
  upgradeUrl: string;
}

export interface EffectiveEntitlements {
  workspaceId: string;
  accountId: string;
  plan: PlanSummary;
  seatsPurchased: number;
  byKey: Record<string, Entitlement>;
}

/**
 * A refusal that names the limit, the plan and the upgrade path.
 *
 * A thrown Error with a sentence would lose the numbers, and the numbers are
 * what let the page render a progress bar and an upgrade button that names the
 * right plan instead of a toast saying "forbidden".
 */
export class PlanLimitError extends Error {
  readonly code = "PLAN_LIMIT_EXCEEDED";
  readonly status = 403;
  constructor(
    readonly detail: {
      limitKey: string;
      limit: number;
      current: number;
      plan: string;
      planName: string;
      upgradeTo: string | null;
      upgradeUrl: string;
    },
    message: string,
  ) {
    super(message);
    this.name = "PlanLimitError";
  }

  toJSON() {
    return { error: this.message, code: this.code, ...this.detail };
  }
}

const LABELS: Record<string, string> = {
  max_members_per_workspace: "members per workspace",
  max_seats: "seats",
  max_workspaces: "workspaces",
};

function label(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ");
}

/** The plan governing a workspace, resolved through its billing account. */
export async function resolveEntitlements(
  workspaceId: string,
): Promise<EffectiveEntitlements | null> {
  const header = await appQueryOne<{
    account_id: string;
    seats: number;
    plan_status: string;
    plan_code: string;
    plan_name: string;
    price_cents: number | null;
    currency: string;
    billing_interval: string;
    price_model: string;
    upgrade_to_code: string | null;
    upgrade_to_name: string | null;
    upgrade_url: string;
  }>(
    `SELECT b.id AS account_id, b.seats, b.plan_status,
            p.code AS plan_code, p.name AS plan_name, p.price_cents, p.currency,
            p.billing_interval, p.price_model,
            p.upgrade_to_code, up.name AS upgrade_to_name, p.upgrade_url
       FROM workspaces w
       JOIN billing_accounts b ON b.id = w.billing_account_id
       JOIN plans p            ON p.code = b.plan_code
       LEFT JOIN plans up      ON up.code = p.upgrade_to_code
      WHERE w.id = $1::uuid`,
    [workspaceId],
  );
  // Null rather than a throw: a deployment whose database predates V060 has no
  // billing account for anything, and the settings page should degrade to "no
  // plan information" rather than 500 on every load.
  if (!header) return null;

  const rows = await appQuery<{
    key: string;
    kind: EntitlementKind;
    scope: "account" | "workspace";
    period: string | null;
    int_value: string | number | null;
    bool_value: boolean | null;
    num_value: number | null;
    text_value: string | null;
    source: string;
  }>(
    `SELECT key, kind, scope, period, int_value, bool_value, num_value, text_value, source
       FROM resolve_entitlements($1::uuid)`,
    [workspaceId],
  );

  const byKey: Record<string, Entitlement> = {};
  for (const row of rows) {
    byKey[row.key] = {
      key: row.key,
      kind: row.kind,
      scope: row.scope,
      period: row.period,
      // BIGINT comes back from `pg` as a string, because a JS number cannot hold
      // every int8. Every value here is a limit or a token count, both far
      // inside Number.MAX_SAFE_INTEGER, so the conversion is safe — but it has
      // to be deliberate, or `"500" > 100` compares as strings and a quota check
      // silently inverts.
      intValue: row.int_value === null ? null : Number(row.int_value),
      boolValue: row.bool_value,
      numValue: row.num_value === null ? null : Number(row.num_value),
      textValue: row.text_value,
      source: row.source,
    };
  }

  return {
    workspaceId,
    accountId: header.account_id,
    seatsPurchased: header.seats,
    plan: {
      code: header.plan_code,
      name: header.plan_name,
      priceCents: header.price_cents,
      currency: header.currency,
      billingInterval: header.billing_interval,
      priceModel: header.price_model,
      status: header.plan_status,
      upgradeTo: header.upgrade_to_code,
      upgradeToName: header.upgrade_to_name,
      upgradeUrl: header.upgrade_url,
    },
    byKey,
  };
}

/** A feature gate. Fails CLOSED: an absent key is off, never on. */
export function hasFeature(eff: EffectiveEntitlements | null, key: string): boolean {
  return eff?.byKey[key]?.boolValue === true;
}

/** A ceiling, or null for "the catalogue has no opinion" / unlimited. */
export function limitOf(eff: EffectiveEntitlements | null, key: string): number | null {
  const value = eff?.byKey[key]?.intValue;
  if (value === null || value === undefined) return null;
  return value < 0 ? null : value;
}

/**
 * Refuse a new member when the workspace is full, or when the account has no
 * seat left for somebody who is not already on it.
 *
 * TWO CHECKS, BECAUSE UNDER PER-SEAT PRICING THEY MEAN DIFFERENT THINGS:
 *
 *   max_members_per_workspace  a workspace ceiling — plan policy about how big
 *                              one workspace may get.
 *   max_seats                  a BILLING quantity. A person already on the
 *                              account costs nothing to add to a second
 *                              workspace, which is what makes "invite your
 *                              colleague to the project workspace" free rather
 *                              than a billing event.
 *
 * Collapsing them would either bill for a colleague twice, or let an account add
 * unlimited people by spreading them one per workspace.
 *
 * [email] is looked up rather than trusted: an invitation names an address, and
 * whether that address already holds a seat on THIS ACCOUNT is the only question
 * that decides whether it costs one. Nothing here consults the inviter's plan.
 */
export async function requireSeatForNewMember(args: {
  workspaceId: string;
  /** The invitee's email, lower-cased. Null when adding a known user id. */
  email?: string | null;
  /** The invitee's app_users id, when already known. */
  userId?: string | null;
}): Promise<void> {
  const eff = await resolveEntitlements(args.workspaceId);
  // A deployment without billing accounts enforces nothing rather than refusing
  // everything. Same reasoning as `resolveEntitlements` returning null.
  if (!eff) return;

  /*
   * SHADOW MODE, sharing `ENTITLEMENTS_ENFORCED` with the Kotlin guard.
   *
   * Off by default: the repo's rule is that a new runtime behaviour ships behind
   * a flag until its phase is signed off, and what is new here is the REFUSING.
   * Until it is armed, a check that would have refused logs what it would have
   * done — so "which customers does this break" is a log query rather than a
   * support ticket.
   *
   * ONE flag across both services, deliberately. Two would be two chances to set
   * only one, and a customer refused a seat by the web app while the API happily
   * admits their runs is a product that disagrees with itself.
   */
  const enforcing = process.env.ENTITLEMENTS_ENFORCED?.toLowerCase() === "true";

  const refuse = (limitKey: string, limit: number, current: number): void => {
    const error = new PlanLimitError(
      {
        limitKey,
        limit,
        current,
        plan: eff.plan.code,
        planName: eff.plan.name,
        upgradeTo: eff.plan.upgradeToName,
        upgradeUrl: eff.plan.upgradeUrl,
      },
      `The ${eff.plan.name} plan allows ${limit} ${label(limitKey)} and this workspace has ${current}. ` +
        (eff.plan.upgradeToName
          ? `Upgrade to ${eff.plan.upgradeToName} to raise the limit.`
          : "Contact us to raise the limit."),
    );
    if (enforcing) throw error;
    // Returns `void` rather than `never` because in shadow mode it genuinely
    // returns. Annotating it `never` would make TypeScript treat the code after
    // each call as unreachable, and the seat check below would stop being
    // analysed — a type-level lie that hides the second half of this function.
    console.info("[entitlements] WOULD REFUSE:", error.message, error.detail);
  };

  // ── The workspace ceiling ────────────────────────────────────────────────
  const memberLimit = limitOf(eff, "max_members_per_workspace");
  if (memberLimit !== null) {
    const row = await appQueryOne<{ count: string }>(
      `SELECT count(*)::text AS count FROM workspace_members
        WHERE workspace_id = $1::uuid AND status = 'active'`,
      [args.workspaceId],
    );
    const current = Number(row?.count ?? 0);
    // `>=` because the count is taken BEFORE the member being added: a workspace
    // holding 3 of 3 must be refused the fourth.
    if (current >= memberLimit) refuse("max_members_per_workspace", memberLimit, current);
  }

  // ── The seat ─────────────────────────────────────────────────────────────
  const alreadyOnAccount = await appQueryOne<{ one: number }>(
    `SELECT 1 AS one
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
       LEFT JOIN app_users u ON u.id = m.user_id
      WHERE w.billing_account_id = $1::uuid
        AND m.status = 'active'
        AND ( ($2::uuid IS NOT NULL AND m.user_id = $2::uuid)
           OR ($3::text IS NOT NULL AND lower(u.email) = $3::text) )
      LIMIT 1`,
    [eff.accountId, args.userId ?? null, args.email?.trim().toLowerCase() ?? null],
  );
  // Already paid for — adding them to another workspace on the same account is
  // free. This is the DISTINCT in `account_seats_used()`, asked one row at a
  // time.
  if (alreadyOnAccount) return;

  const planMaxSeats = limitOf(eff, "max_seats");
  // The purchased quantity is the real cap; the plan's max_seats caps what may
  // be purchased. The tighter of the two binds; unlimited on either means
  // "whatever was bought".
  const cap =
    planMaxSeats === null
      ? eff.seatsPurchased
      : Math.min(planMaxSeats, eff.seatsPurchased);

  const seats = await appQueryOne<{ used: number }>(
    `SELECT account_seats_used($1::uuid) AS used`,
    [eff.accountId],
  );
  const used = Number(seats?.used ?? 0);

  // Pending invitations count too. Without this an account at its seat cap can
  // send unlimited invitations that all fail on acceptance — the refusal arrives
  // for the invitee, who cannot act on it, instead of for the admin, who can.
  const pending = await appQueryOne<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM workspace_invitations i
       JOIN workspaces w ON w.id = i.workspace_id
      WHERE w.billing_account_id = $1::uuid
        AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
    [eff.accountId],
  );
  const committed = used + Number(pending?.count ?? 0);

  if (committed >= cap) refuse("max_seats", cap, committed);
}

/* ══════════════════════════════════════════════════════════════════════════════
   THE PLAN PANEL

   Everything the Plan & access screen needs, in one shape, assembled from the
   same functions the enforcement points use.

   WHY THE PAGE GETS RESOLVED ENTITLEMENTS AND NOT A PLAN CODE. A settings page
   that renders from a code has to keep its own copy of what each plan includes,
   and that copy is wrong the first time somebody raises a limit in the
   database — which is the whole point of making plans data. So the page is
   handed the resolved rows, each with the live count it is compared against and
   where its value came from, and it renders whatever it is given.

   `source` is surfaced deliberately: an admin looking at a limit that does not
   match the public pricing page should be able to see that it is an override
   rather than conclude the page is lying.
══════════════════════════════════════════════════════════════════════════════ */

export interface PlanPanelEntry {
  key: string;
  label: string;
  /** Null means unlimited. */
  limit: number | null;
  /** What it is compared against, when there is something to compare. */
  current: number | null;
  period: string | null;
  source: string;
}

export interface PlanPanel {
  plan: PlanSummary;
  seats: { purchased: number; used: number; max: number | null };
  period: { start: string; end: string } | null;
  quotas: PlanPanelEntry[];
  limits: PlanPanelEntry[];
  features: { key: string; label: string; enabled: boolean; source: string }[];
  supportTier: string | null;
  schedulingPriority: number | null;
}

const QUOTA_METRIC: Record<string, string> = {
  runs_per_month: "runs",
  agent_minutes_per_month: "agent_minutes",
  tokens_per_month: "tokens",
};

const QUOTA_LABELS: Record<string, string> = {
  runs_per_month: "Runs this month",
  agent_minutes_per_month: "Agent minutes this month",
  tokens_per_month: "Tokens this month",
};

const LIMIT_LABELS: Record<string, string> = {
  max_workspaces: "Workspaces",
  max_members_per_workspace: "Members in this workspace",
  max_concurrent_runs: "Concurrent runs",
  max_agents: "Agents in this workspace",
  max_team_size: "Agents in a team",
  max_delegation_depth: "Delegation depth",
  retention_days_runs: "Run history",
  retention_days_events: "Event history",
  retention_days_traces: "Trace history",
  retention_days_payloads: "Payload history",
};

const FEATURE_LABELS: Record<string, string> = {
  teams: "Agent teams",
  delegation: "Delegation",
  replay: "Replay",
  otel_export: "OpenTelemetry export",
  mcp_tools: "MCP tools",
  api_access: "API access",
};

/**
 * Assemble the panel. Throws only when the database is unreachable; a workspace
 * with no billing account returns null, which the route reports as an
 * unavailable source rather than an error.
 */
export async function getWorkspacePlanPanel(workspaceId: string): Promise<PlanPanel | null> {
  const eff = await resolveEntitlements(workspaceId);
  if (!eff) return null;

  const [period, usageRows, counts] = await Promise.all([
    appQueryOne<{ period_start: string; period_end: string }>(
      `SELECT period_start, period_end FROM account_current_period($1::uuid)`,
      [eff.accountId],
    ),
    appQuery<{ metric: string; used: string }>(
      `SELECT metric, used::text AS used FROM account_usage($1::uuid)`,
      [eff.accountId],
    ),
    appQueryOne<{
      workspaces: string;
      members: string;
      agents: string;
      seats: number;
    }>(
      `SELECT (SELECT count(*) FROM workspaces WHERE billing_account_id = $1::uuid)::text AS workspaces,
              (SELECT count(*) FROM workspace_members
                WHERE workspace_id = $2::uuid AND status = 'active')::text            AS members,
              (SELECT count(*) FROM agents
                WHERE workspace_id = $2::uuid
                  AND COALESCE(status,'active') <> 'archived')::text                  AS agents,
              account_seats_used($1::uuid)                                            AS seats`,
      [eff.accountId, workspaceId],
    ),
  ]);

  const used: Record<string, number> = {};
  for (const row of usageRows) used[row.metric] = Math.ceil(Number(row.used));

  const currentFor: Record<string, number | null> = {
    max_workspaces: Number(counts?.workspaces ?? 0),
    max_members_per_workspace: Number(counts?.members ?? 0),
    max_agents: Number(counts?.agents ?? 0),
  };

  const entry = (key: string, labels: Record<string, string>, current: number | null): PlanPanelEntry | null => {
    const ent = eff.byKey[key];
    if (!ent) return null;
    return {
      key,
      label: labels[key] ?? label(key),
      limit: ent.intValue === null || ent.intValue < 0 ? null : ent.intValue,
      current,
      period: ent.period,
      source: ent.source,
    };
  };

  const quotas = Object.keys(QUOTA_METRIC)
    .map((key) => entry(key, QUOTA_LABELS, used[QUOTA_METRIC[key]] ?? 0))
    .filter((e): e is PlanPanelEntry => e !== null);

  const limits = Object.keys(LIMIT_LABELS)
    .map((key) => entry(key, LIMIT_LABELS, currentFor[key] ?? null))
    .filter((e): e is PlanPanelEntry => e !== null);

  const features = Object.keys(FEATURE_LABELS)
    .filter((key) => eff.byKey[key])
    .map((key) => ({
      key,
      label: FEATURE_LABELS[key],
      enabled: eff.byKey[key].boolValue === true,
      source: eff.byKey[key].source,
    }));

  const planMaxSeats = limitOf(eff, "max_seats");

  return {
    plan: eff.plan,
    seats: {
      purchased: eff.seatsPurchased,
      used: Number(counts?.seats ?? 0),
      max: planMaxSeats,
    },
    period: period ? { start: period.period_start, end: period.period_end } : null,
    quotas,
    limits,
    features,
    supportTier: eff.byKey.support_tier?.textValue ?? null,
    schedulingPriority: eff.byKey.scheduling_priority?.numValue ?? null,
  };
}

/**
 * Refuse a new workspace when the owner's account is already at `max_workspaces`.
 *
 * ── WHY THIS TAKES A USER WHEN NOTHING ELSE HERE DOES ───────────────────────
 * Because there is no workspace to resolve from yet, and the governing rule has
 * to be preserved rather than waived. It is preserved by resolving through an
 * ANCHOR: a workspace the user already OWNS identifies the account the new one
 * will join — the same account the `assign_billing_account` trigger will pick.
 * Every workspace on an account resolves identically, because the plan is on the
 * account.
 *
 * The anchor is a workspace they OWN, never one they were invited to. Being a
 * member of somebody's Team workspace must grant no headroom on your own Free
 * account — that is exploit (1) wearing exploit (2)'s clothes.
 *
 * No anchor means this is their first workspace: always allowed. Refusing a
 * brand-new user their first workspace because a plan says "1" would lock them
 * out of the product on the way in.
 *
 * Mirrors `EntitlementGuard.requireNewWorkspaceAllowed`. Two implementations
 * because the two services share no code — and the acceptance criterion is that
 * an account at its ceiling cannot create another "by API or UI", which means
 * both doors have to be shut. `SharedWorkspaceExploitTest` covers the Kotlin one.
 */
export async function requireNewWorkspaceAllowed(ownerUserId: string): Promise<void> {
  const anchor = await appQueryOne<{ id: string }>(
    `SELECT id FROM workspaces WHERE owner_user_id = $1::uuid ORDER BY created_at LIMIT 1`,
    [ownerUserId],
  );
  if (!anchor) return;

  const eff = await resolveEntitlements(anchor.id);
  if (!eff) return;

  const limit = limitOf(eff, "max_workspaces");
  if (limit === null) return;

  const row = await appQueryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM workspaces WHERE billing_account_id = $1::uuid`,
    [eff.accountId],
  );
  const current = Number(row?.count ?? 0);
  // `>=` because the count is taken BEFORE the workspace being created.
  if (current < limit) return;

  const error = new PlanLimitError(
    {
      limitKey: "max_workspaces",
      limit,
      current,
      plan: eff.plan.code,
      planName: eff.plan.name,
      upgradeTo: eff.plan.upgradeToName,
      upgradeUrl: eff.plan.upgradeUrl,
    },
    `The ${eff.plan.name} plan allows ${limit} ${limit === 1 ? "workspace" : "workspaces"} and this account has ${current}. ` +
      (eff.plan.upgradeToName
        ? `Upgrade to ${eff.plan.upgradeToName} to create more.`
        : "Contact us to raise the limit."),
  );

  // Shares `ENTITLEMENTS_ENFORCED` with every other check — see
  // `requireSeatForNewMember` for why one flag and not two.
  if (process.env.ENTITLEMENTS_ENFORCED?.toLowerCase() === "true") throw error;
  console.info("[entitlements] WOULD REFUSE:", error.message, error.detail);
}
