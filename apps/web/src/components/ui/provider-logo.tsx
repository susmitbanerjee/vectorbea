import * as React from "react";
import { cn } from "~/lib/cn";
import { PROVIDER_BRAND_COLOUR, PROVIDER_DARK_COLOUR } from "./provider-brand-colours";

/**
 * <ProviderLogo> — the vendor's mark, in the vendor's colour.
 *
 * ── WHY THIS IS NO LONGER RATIONED ──────────────────────────────────────────
 * It used to render monochrome until a connection was live, so that "connected"
 * was scannable down a long list. That traded the wrong thing away. The list it
 * was optimising is a handful of rows, the health state is already carried by a
 * dot, a label and a status token — three signals that do not need a fourth —
 * and the cost was an Integrations page where nothing was recognisable at a
 * glance. Recognition is what a logo is FOR; greying it out to encode something
 * the row says twice already is the one job it cannot also do.
 *
 * So colour is now the default, and `connected` raises the surface rather than
 * the hue: a solid chip and a full-strength border against a tinted chip and a
 * subtle one. Same information, carried by weight instead of by saturation.
 *
 * ── AND WHY THE FALLBACK MATTERS AS MUCH AS THE MARKS ───────────────────────
 * MCP means a customer can connect a vendor we have never heard of. An unknown
 * provider used to render NOTHING, which on the discovery screen would be a
 * list of tool names with a hole beside each one — indistinguishable from
 * discovery having half-failed. [Monogram] draws a deterministic coloured chip
 * instead, so every discovered tool is identifiable whether or not we happen to
 * have drawn its vendor.
 *
 * TRADEMARK NOTE: these are simplified geometric marks drawn to sit on a common
 * grid, used nominatively to identify each service. They are not pixel-accurate
 * reproductions of the official logos. Before a public launch, replace the paths
 * in PROVIDER_MARKS with each vendor's official SVG from their brand kit and
 * check the attribution rules that come with it — several (Slack, HubSpot,
 * Atlassian) place conditions on colour, spacing and minimum size.
 */

export type ProviderId =
  | "openai" | "anthropic" | "gemini" | "mistral"
  | "slack" | "gmail" | "google-sheets" | "notion" | "airtable"
  | "postgres" | "mysql" | "hubspot" | "github" | "jira"
  | "webhook" | "http" | "mcp"
  /*
   * ── VENDORS WE DO NOT SHIP AN ADAPTER FOR ─────────────────────────────────
   *
   * These are here to be RECOGNISED, not to be offered. They are not in
   * `INTEGRATION_SEEDS` and there is no connect flow behind any of them —
   * the way you reach Grafana or ServiceNow is their MCP server.
   *
   * Which is exactly why the marks have to exist. When somebody connects an
   * MCP server and discovery answers, "12 tools registered" with a generic
   * plug beside each one reads as a list of strings. The same list with the
   * vendor's mark beside it reads as "Vectorbea found ServiceNow", which is
   * the sentence discovery is actually trying to say.
   */
  | "grafana" | "servicenow" | "datadog" | "sentry" | "linear" | "stripe"
  | "snowflake" | "pagerduty" | "zendesk" | "salesforce" | "gitlab"
  | "confluence" | "mongodb" | "elastic" | "shopify" | "twilio"
  | "kubernetes" | "aws";

type ProviderMark = {
  label: string;
  paths: React.ReactNode;
};

/* Geometry is drawn on a 24×24 grid to match the icon set. `currentColor` is
   used throughout so the monochrome state needs no separate artwork. */
const PROVIDER_MARKS: Record<ProviderId, ProviderMark> = {
  openai: {
    label: "OpenAI",
    paths: (
      <path
        d="M12 3.2 18.4 6.9v7.4L12 18l-6.4-3.7V6.9Zm0 0v7.4m0 0 6.4 3.7M12 10.6 5.6 14.3"
        fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"
      />
    ),
  },
  anthropic: {
    label: "Anthropic",
    paths: (
      <path d="M8.6 4h3.1l5.7 16h-3.3l-1.2-3.5H7.3L6.1 20H2.8Zm.5 4.4-1.9 5.4h3.8Z" fill="currentColor" />
    ),
  },
  gemini: {
    label: "Google Gemini",
    paths: (
      <path d="M12 2.5c.6 5 4 8.4 9 9-5 .6-8.4 4-9 9-.6-5-4-8.4-9-9 5-.6 8.4-4 9-9Z" fill="currentColor" />
    ),
  },
  mistral: {
    label: "Mistral AI",
    paths: (
      <g fill="currentColor">
        <rect x="3" y="5" width="3.6" height="14" />
        <rect x="10.2" y="5" width="3.6" height="7" />
        <rect x="17.4" y="5" width="3.6" height="14" />
        <rect x="10.2" y="15.4" width="3.6" height="3.6" />
      </g>
    ),
  },
  slack: {
    label: "Slack",
    paths: (
      <g fill="currentColor">
        <rect x="9.6" y="2.6" width="3.2" height="10" rx="1.6" />
        <rect x="11.2" y="11.4" width="10" height="3.2" rx="1.6" />
        <rect x="11.2" y="11.4" width="3.2" height="10" rx="1.6" />
        <rect x="2.8" y="9.4" width="10" height="3.2" rx="1.6" />
      </g>
    ),
  },
  gmail: {
    label: "Gmail",
    paths: (
      <path
        d="M3 6.5 12 13l9-6.5M3 6.5h18v11H3Z"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
      />
    ),
  },
  "google-sheets": {
    label: "Google Sheets",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M5 3h9l5 5v13H5Z" />
        <path d="M14 3v5h5" />
        <path d="M8 12h8M8 16h8M12 12v4" />
      </g>
    ),
  },
  notion: {
    label: "Notion",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M4 4.5 14.5 3.4 20 6.4v13L9 20.6 4 18Z" />
        <path d="M9 8.2v8l1.8.2V11l4.4 5.6 1.6.1V8.9" />
      </g>
    ),
  },
  airtable: {
    label: "Airtable",
    paths: (
      <g fill="currentColor">
        <path d="M12 3 2.5 7l9.5 3.6L21.5 7Z" />
        <path d="M2.5 9.4v6.3L11 19.6v-6.6Z" opacity="0.75" />
        <path d="M21.5 9.4v6.3L13 19.6v-6.6Z" opacity="0.5" />
      </g>
    ),
  },
  postgres: {
    label: "PostgreSQL",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <ellipse cx="12" cy="6" rx="7.5" ry="3" />
        <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
        <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
      </g>
    ),
  },
  mysql: {
    label: "MySQL",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        <path d="M3 17.5c3 0 4.5-2 4.5-5S6 8 3.6 8" />
        <path d="M8 17.5V9l3.5 5L15 9v8.5" />
        <path d="M17.5 17.5h3.5" />
      </g>
    ),
  },
  hubspot: {
    label: "HubSpot",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="8" cy="15.5" r="3.5" />
        <circle cx="17.5" cy="7" r="2.6" />
        <path d="M17.5 9.6v3.2M10.4 13.6 15 10.4" />
        <path d="M17.5 4.4V2" />
      </g>
    ),
  },
  github: {
    label: "GitHub",
    paths: (
      <path
        d="M12 2.6a9.4 9.4 0 0 0-3 18.3c.5.1.6-.2.6-.5v-1.7c-2.6.6-3.2-1.2-3.2-1.2-.4-1.1-1-1.4-1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.8.8.1-.6.3-1.1.6-1.3-2.1-.2-4.3-1-4.3-4.6 0-1 .4-1.9 1-2.5-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.6 1a9 9 0 0 1 4.7 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.6.6.6 1 1.5 1 2.5 0 3.6-2.2 4.4-4.3 4.6.3.3.6.9.6 1.8v2.7c0 .3.2.6.7.5A9.4 9.4 0 0 0 12 2.6Z"
        fill="currentColor"
      />
    ),
  },
  jira: {
    label: "Jira",
    paths: (
      <g fill="currentColor">
        <path d="M12 2.5 20.5 11h-4.2a4.3 4.3 0 0 1-4.3-4.3Z" opacity="0.75" />
        <path d="M12 21.5 3.5 13h4.2a4.3 4.3 0 0 1 4.3 4.3Z" opacity="0.75" />
        <path d="M12 7.8 16.2 12 12 16.2 7.8 12Z" />
      </g>
    ),
  },
  webhook: {
    label: "Webhook",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="16.5" r="3" />
        <circle cx="17" cy="16.5" r="3" />
        <circle cx="12" cy="6" r="3" />
        <path d="M10.5 8.6 8.2 13.6M13.5 8.6l2.3 5M10 16.5h4" />
      </g>
    ),
  },
  http: {
    label: "HTTP request",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
      </g>
    ),
  },
  /*
   * A socket with three leads: one server, several tools. The mark says the
   * grant model before any copy does — what plugs in is a set of separate
   * things, not one switch.
   */
  mcp: {
    label: "MCP server",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="13" width="16" height="7" rx="2" />
        <path d="M8 13V8.5a2 2 0 0 1 4 0V13M16 13V9.5" />
        <circle cx="16" cy="6.5" r="2" />
      </g>
    ),
  },

  /* ── Recognised, not offered. See the note on ProviderId. ─────────────── */

  grafana: {
    label: "Grafana",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18h18" />
        <path d="M4.5 15.5 9 10l3.5 3.5L16 7.5l3.5 5" />
        <circle cx="9" cy="10" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="16" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
      </g>
    ),
  },
  servicenow: {
    label: "ServiceNow",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="10.5" r="7" />
        <path d="M8 18.2a7.6 7.6 0 0 0 8 0" />
        <path d="M9.2 12.5V8.8l5.6 3.8V8.8" />
      </g>
    ),
  },
  datadog: {
    label: "Datadog",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19.5 4.5 7.5 8 5 13.5l4 1.5 1.5 4.5 4-2.5" />
        <path d="M9 14.5 13 11l3-4.5" />
        <circle cx="10.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      </g>
    ),
  },
  sentry: {
    label: "Sentry",
    paths: (
      <path
        d="M12 3.4a1.6 1.6 0 0 1 1.4.8l7.2 12.5a1.6 1.6 0 0 1-1.4 2.4h-2.6a8.9 8.9 0 0 0-5-7.3l-1.5 2.6a5.9 5.9 0 0 1 3.4 4.7H4.8a1.6 1.6 0 0 1-1.4-2.4l7.2-12.5A1.6 1.6 0 0 1 12 3.4Z"
        fill="currentColor"
      />
    ),
  },
  linear: {
    label: "Linear",
    paths: (
      <g fill="currentColor">
        <path d="M3.2 13.6 10.4 20.8a9 9 0 0 1-7.2-7.2Z" />
        <path d="M3.05 10.6 13.4 20.95a9 9 0 0 0 2.4-.9L3.95 8.2a9 9 0 0 0-.9 2.4Z" />
        <path d="M5.3 6.2 17.8 18.7a9.1 9.1 0 0 0 1.6-1.5L6.8 4.6a9.1 9.1 0 0 0-1.5 1.6Z" />
        <path d="M9 3.4 20.6 15a9 9 0 0 0-11.6-11.6Z" />
      </g>
    ),
  },
  stripe: {
    label: "Stripe",
    paths: (
      <path
        d="M13.4 9.6c-1.5 0-2.4.4-2.4 1.2 0 .9 1.1 1.2 2.6 1.7 2.4.7 4 1.6 4 3.9 0 2.6-2.1 4-5.1 4a10 10 0 0 1-4.4-1v-3.2a9 9 0 0 0 4.3 1.3c1.6 0 2.3-.4 2.3-1.2 0-.9-1-1.2-2.6-1.7-2.4-.7-4-1.7-4-4 0-2.5 2-3.9 5-3.9a9.6 9.6 0 0 1 4 .9v3.1a8.7 8.7 0 0 0-3.7-1.1Z"
        fill="currentColor"
      />
    ),
  },
  snowflake: {
    label: "Snowflake",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
        <path d="M12 6.5 9.8 4.8M12 6.5l2.2-1.7M12 17.5l-2.2 1.7M12 17.5l2.2 1.7" />
      </g>
    ),
  },
  pagerduty: {
    label: "PagerDuty",
    paths: (
      <g fill="currentColor">
        <path d="M5.5 3h5.9c3.6 0 6.1 1.9 6.1 5.2s-2.5 5.3-6.1 5.3H8.9V3Zm3.4 2.6v5.3h2.3c1.9 0 3-.9 3-2.6s-1.1-2.7-3-2.7Z" />
        <rect x="5.5" y="16" width="3.4" height="5" />
      </g>
    ),
  },
  zendesk: {
    label: "Zendesk",
    paths: (
      <g fill="currentColor">
        <path d="M11 6.5v12H2.5Z" />
        <path d="M2.5 3.5H11a4.3 4.3 0 0 1-8.5 0Z" />
        <path d="M13 17.5v-12h8.5Z" />
        <path d="M21.5 20.5H13a4.3 4.3 0 0 1 8.5 0Z" />
      </g>
    ),
  },
  salesforce: {
    label: "Salesforce",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M6.5 17.5a3.5 3.5 0 0 1-.4-7 4.6 4.6 0 0 1 8.3-2.3 3.9 3.9 0 0 1 5.6 3.5 3.9 3.9 0 0 1-3.9 3.9Z" />
      </g>
    ),
  },
  gitlab: {
    label: "GitLab",
    paths: (
      <path d="m12 21-3.4-10.4h6.8Zm0 0L4.2 10.6h4.4Zm0 0 7.8-10.4h-4.4ZM4.2 10.6 2.6 5.5c-.1-.4.3-.7.6-.5l3.6 2.6Zm15.6 0 1.6-5.1c.1-.4-.3-.7-.6-.5l-3.6 2.6Z" fill="currentColor" />
    ),
  },
  confluence: {
    label: "Confluence",
    paths: (
      <g fill="currentColor">
        <path d="M3 16.3c2.6-4.3 5.6-6 8.8-5 2.4.7 4 2.6 6 6l3.2-1.9c-2.5-4.3-4.9-6.9-8.4-8-4.5-1.4-8.4 1-11.2 6.3Z" opacity="0.8" />
        <path d="M21 7.7c-2.6 4.3-5.6 6-8.8 5-2.4-.7-4-2.6-6-6L3 8.6c2.5 4.3 4.9 6.9 8.4 8 4.5 1.4 8.4-1 11.2-6.3Z" />
      </g>
    ),
  },
  mongodb: {
    label: "MongoDB",
    paths: (
      <path
        d="M12 2.5c2.3 3 5 5.3 5 9.3 0 3.4-2.2 5.9-4.3 6.7l-.3 3h-.8l-.3-3C9.2 17.7 7 15.2 7 11.8c0-4 2.7-6.3 5-9.3Zm0 4.2v10.6c1.3-.8 2.4-2.6 2.4-5.1 0-2.4-1.1-4-2.4-5.5Z"
        fill="currentColor"
      />
    ),
  },
  elastic: {
    label: "Elastic",
    paths: (
      <g fill="currentColor">
        <path d="M4 5h16a8.9 8.9 0 0 1-1.2 3H5.4A9.4 9.4 0 0 1 4 5Z" />
        <path d="M6.2 10h11.6a9 9 0 0 1 0 4H6.2a9 9 0 0 1 0-4Z" opacity="0.75" />
        <path d="M5.4 16h13.4A8.9 8.9 0 0 1 4 19Z" opacity="0.5" />
      </g>
    ),
  },
  shopify: {
    label: "Shopify",
    paths: (
      <path
        d="M14.6 4.3c.4.1.6.3.6.7l1.7 12.6-8.3 1.7L6 5.6l2.6-.8a4 4 0 0 1 3.8-3c1 0 1.7.6 2.2 1.5Zm-2.2 1.2a3.6 3.6 0 0 0-.6-1.5c-.8 0-1.6.9-2 2.3Z"
        fill="currentColor"
      />
    ),
  },
  twilio: {
    label: "Twilio",
    paths: (
      <g fill="currentColor">
        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2.4a6.6 6.6 0 1 1 0 13.2 6.6 6.6 0 0 1 0-13.2Z" />
        <circle cx="9.6" cy="9.6" r="1.8" />
        <circle cx="14.4" cy="9.6" r="1.8" />
        <circle cx="9.6" cy="14.4" r="1.8" />
        <circle cx="14.4" cy="14.4" r="1.8" />
      </g>
    ),
  },
  kubernetes: {
    label: "Kubernetes",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M12 2.6 20.3 6.6 18.3 16 12 21.4 5.7 16 3.7 6.6Z" />
        <path d="M12 8.2 15.4 10.7 14.1 14.7H9.9L8.6 10.7Z" />
      </g>
    ),
  },
  aws: {
    label: "AWS",
    paths: (
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5 5.2 15l2-4.2L9.2 15l2.2-5.5" />
        <path d="M13.6 9.5 15.8 15l1.5-3.2L18.8 15 21 9.5" />
        <path d="M3.5 18.4c5.6 2.6 11.4 2.6 17 0" />
      </g>
    ),
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDER_MARKS) as ProviderId[];

export function providerLabel(id: ProviderId): string {
  return PROVIDER_MARKS[id].label;
}

export interface ProviderLogoProps {
  /**
   * A drawn provider, or any free string.
   *
   * A string that is not a known id is resolved through [resolveProvider] and
   * falls back to a monogram — which is what makes this usable on MCP
   * discovery, where the vendor is whatever the customer's server is called.
   */
  provider: ProviderId | string;
  /** A solid chip and a full-strength border. The MARK is in colour either way. */
  connected?: boolean;
  size?: number;
  /** Hide from assistive tech when an adjacent label already names the provider. */
  decorative?: boolean;
  /** Used for the monogram when the provider is not one we have drawn. */
  fallbackLabel?: string;
  className?: string;
}

export function ProviderLogo({
  provider,
  connected = false,
  size = 20,
  decorative = false,
  fallbackLabel,
  className,
}: ProviderLogoProps) {
  const resolved = resolveProvider(provider);
  const mark = resolved ? PROVIDER_MARKS[resolved] : undefined;

  /*
   * An unresolved provider gets a monogram, not nothing.
   *
   * Provider ids arrive from tool names (`contracts.getUpcomingRenewals` →
   * `contracts`) and now from MCP server names, so the set of inputs is open
   * while the set of drawn marks is not. Rendering nothing used to be the
   * guard against a crash; it is the wrong answer on any screen that is
   * listing things, because an empty slot reads as a failure rather than as an
   * unfamiliar vendor.
   */
  if (!mark) {
    return (
      <Monogram
        text={fallbackLabel ?? (typeof provider === "string" ? provider : "")}
        size={size}
        connected={connected}
        decorative={decorative}
        className={className}
      />
    );
  }

  const label = connected ? `${mark.label}, connected` : mark.label;
  const colour = brandColour(resolved!);

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border transition-colors duration-fast",
        connected ? "border-default" : "border-subtle",
        className,
      )}
      style={{
        width: size + 12,
        height: size + 12,
        /* The brand colour is applied as currentColor, so every mark — stroked
           or filled — picks it up without needing a second copy of the artwork. */
        color: colour,
        /* A wash of the vendor's own colour rather than a neutral grey. Mixed
           against the theme's surface token, so it lands correctly in both
           themes without a second value per brand. `connected` raises the
           surface; it no longer changes the hue. */
        backgroundColor: `color-mix(in srgb, ${colour} ${connected ? 18 : 11}%, var(--bg-raised))`,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        focusable="false"
        aria-hidden={decorative ? true : undefined}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : label}
      >
        {mark.paths}
      </svg>
    </span>
  );
}

/**
 * A vendor we have not drawn, rendered as its own initial on a stable colour.
 *
 * Deterministic from the text, so the same server is the same colour on every
 * screen and on every reload — a chip that changed hue between the discovery
 * step and the Tools tab would read as two different things.
 *
 * The palette is the eight brand hues already sanctioned in
 * `provider-brand-colours.ts`, reused rather than extended: this needs colours
 * that are distinguishable and that already pass contrast against both
 * surfaces, and inventing a ninth would mean inventing a ninth contrast check.
 */
function Monogram({
  text, size, connected, decorative, className,
}: {
  text: string;
  size: number;
  connected: boolean;
  decorative: boolean;
  className?: string;
}) {
  const cleaned = text.replace(/^(mcp[-_.\s]*)/i, "").trim();
  const initial = (cleaned.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();

  let hash = 0;
  for (let i = 0; i < cleaned.length; i += 1) hash = (hash * 31 + cleaned.charCodeAt(i)) >>> 0;
  const colour = MONOGRAM_PALETTE[hash % MONOGRAM_PALETTE.length];

  return (
    <span
      className={cn(
        "font-ui inline-flex items-center justify-center rounded-md border font-semibold",
        "transition-colors duration-fast",
        connected ? "border-default" : "border-subtle",
        className,
      )}
      style={{
        width: size + 12,
        height: size + 12,
        fontSize: Math.round(size * 0.58),
        color: colour,
        backgroundColor: `color-mix(in srgb, ${colour} ${connected ? 18 : 11}%, var(--bg-raised))`,
      }}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (cleaned || "Unknown provider")}
    >
      {initial}
    </span>
  );
}

const MONOGRAM_PALETTE = [
  PROVIDER_BRAND_COLOUR.stripe,
  PROVIDER_BRAND_COLOUR.grafana,
  PROVIDER_BRAND_COLOUR.snowflake,
  PROVIDER_BRAND_COLOUR.twilio,
  PROVIDER_BRAND_COLOUR.kubernetes,
  PROVIDER_BRAND_COLOUR.pagerduty,
  PROVIDER_BRAND_COLOUR.salesforce,
  PROVIDER_BRAND_COLOUR.gitlab,
];

/** Dark-theme substitute for the marks whose brand colour is near-black. */
function brandColour(id: ProviderId): string {
  const override = PROVIDER_DARK_COLOUR[id];
  if (!override) return PROVIDER_BRAND_COLOUR[id];
  /* A CSS variable the theme flips, rather than a `useTheme()` read — this
     renders inside tables that would otherwise re-render on every theme
     change, and the browser can do a colour swap without React. */
  return `light-dark(${PROVIDER_BRAND_COLOUR[id]}, ${override})`;
}

/**
 * Map a free string onto a drawn provider.
 *
 * Discovery hands us a server NAME — "Acme Grafana", "servicenow-prod",
 * "github.com/acme" — and a tool name like `mcp-1a2b3c4d.searchIncidents`.
 * None of those is a provider id, and all of them usually contain one.
 *
 * Substring matching, on a deliberately short alias list. This is a
 * RECOGNITION aid: a wrong guess shows the wrong logo beside a correctly-named
 * tool, which is a cosmetic error, while being too strict shows a monogram for
 * a vendor we drew. Neither is expensive, so it errs toward matching.
 */
export function resolveProvider(raw: string | ProviderId | null | undefined): ProviderId | null {
  if (!raw) return null;
  if (raw in PROVIDER_MARKS) return raw as ProviderId;

  const text = String(raw).toLowerCase();
  for (const [alias, id] of PROVIDER_ALIASES) {
    if (text.includes(alias)) return id;
  }
  return null;
}

/**
 * Longest alias first, so `google-sheets` is not eaten by `google`.
 *
 * Order is the whole correctness story here — a Map iterates in insertion
 * order, and the first hit wins.
 */
const PROVIDER_ALIASES: [string, ProviderId][] = ([
  ["google-sheets", "google-sheets"], ["googlesheets", "google-sheets"], ["sheets", "google-sheets"],
  ["servicenow", "servicenow"], ["service-now", "servicenow"], ["snow", "servicenow"],
  ["salesforce", "salesforce"], ["sfdc", "salesforce"],
  ["kubernetes", "kubernetes"], ["k8s", "kubernetes"],
  ["confluence", "confluence"],
  ["pagerduty", "pagerduty"], ["pager-duty", "pagerduty"],
  ["postgresql", "postgres"], ["postgres", "postgres"], ["pgvector", "postgres"],
  ["anthropic", "anthropic"], ["claude", "anthropic"],
  ["snowflake", "snowflake"],
  ["kubernetes", "kubernetes"],
  ["grafana", "grafana"], ["loki", "grafana"], ["prometheus", "grafana"],
  ["datadog", "datadog"], ["dd-agent", "datadog"],
  ["mongodb", "mongodb"], ["mongo", "mongodb"],
  ["elasticsearch", "elastic"], ["elastic", "elastic"], ["opensearch", "elastic"],
  ["shopify", "shopify"],
  ["zendesk", "zendesk"],
  ["airtable", "airtable"],
  ["hubspot", "hubspot"],
  ["gitlab", "gitlab"],
  ["github", "github"],
  ["sentry", "sentry"],
  ["stripe", "stripe"],
  ["twilio", "twilio"],
  ["linear", "linear"],
  ["notion", "notion"],
  ["openai", "openai"], ["gpt", "openai"],
  ["gemini", "gemini"], ["google", "gemini"],
  ["mistral", "mistral"],
  ["slack", "slack"],
  ["gmail", "gmail"],
  ["mysql", "mysql"], ["mariadb", "mysql"],
  ["jira", "jira"], ["atlassian", "jira"],
  ["aws", "aws"], ["amazon", "aws"],
  ["webhook", "webhook"],
] as [string, ProviderId][]);
