import * as React from "react";
import { cn } from "~/lib/cn";
import { PROVIDER_BRAND_COLOUR } from "./provider-brand-colours";

/**
 * <ProviderLogo> — monochrome on a tint until the connection is live.
 *
 * Design §6.3: full colour ONLY when connected. This is what stops the
 * Integrations page reading as a sticker sheet the way Zapier's directory does,
 * and it makes "connected" scannable at a glance across a 40-row list — which is
 * the actual job of that page. Colour is doing information work here, not
 * decoration, which is why it is rationed.
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
  | "webhook" | "http" | "mcp";

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
};

export const PROVIDER_IDS = Object.keys(PROVIDER_MARKS) as ProviderId[];

export function providerLabel(id: ProviderId): string {
  return PROVIDER_MARKS[id].label;
}

export interface ProviderLogoProps {
  provider: ProviderId;
  /** Full colour and a solid surface. Everything else stays monochrome-on-tint. */
  connected?: boolean;
  size?: number;
  /** Hide from assistive tech when an adjacent label already names the provider. */
  decorative?: boolean;
  className?: string;
}

export function ProviderLogo({
  provider,
  connected = false,
  size = 20,
  decorative = false,
  className,
}: ProviderLogoProps) {
  const mark = PROVIDER_MARKS[provider];

  /* An unknown provider renders nothing rather than throwing.
     Provider ids arrive from tool names (`contracts.getUpcomingRenewals` →
     `contracts`), and the set of tool prefixes is open while the set of drawn
     marks is not. Indexing without this guard took down the whole builder with
     "Cannot read properties of undefined (reading 'label')" the first time a
     tool from an unrepresented vendor was selected. */
  if (!mark) return null;

  const label = connected ? `${mark.label}, connected` : mark.label;

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border transition-colors duration-fast",
        connected
          ? "bg-surface-base border-default"
          : "bg-surface-hover border-subtle text-fg-muted",
        className,
      )}
      style={{
        width: size + 12,
        height: size + 12,
        // The brand colour is applied as currentColor, so every mark — stroked
        // or filled — picks it up without needing a second copy of the artwork.
        color: connected ? PROVIDER_BRAND_COLOUR[provider] : undefined,
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
