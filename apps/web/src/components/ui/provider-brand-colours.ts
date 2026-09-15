/**
 * THIRD-PARTY BRAND COLOURS — the one sanctioned exception to hard rule 1.
 *
 * These are not design tokens and must never be treated as such. They are other
 * companies' trademarks, fixed by their brand guidelines, and we do not get to
 * theme them: OpenAI green is OpenAI green in both light and dark. Putting them
 * in src/styles/tokens/ would imply they are part of Ink & Iris and would invite
 * someone to reach for `#10a37f` as "a green". They are quarantined here
 * instead, and this file is the only path excluded from the raw-hex ban in
 * eslint.config.mjs and scripts/check-design-tokens.mjs.
 *
 * They are used in exactly one place — <ProviderLogo> in the `connected` state —
 * because design §6.3 rations full colour to that state alone.
 *
 * Replace these with the exact values from each vendor's brand kit before a
 * public launch; several place conditions on colour reproduction.
 */

import type { ProviderId } from "./provider-logo";

export const PROVIDER_BRAND_COLOUR: Record<ProviderId, string> = {
  openai: "#10a37f",
  anthropic: "#d97757",
  gemini: "#4285f4",
  mistral: "#fa520f",
  slack: "#611f69",
  teams: "#5059c9",
  "google-chat": "#00ac47",
  discord: "#5865f2",
  gmail: "#ea4335",
  "google-sheets": "#0f9d58",
  notion: "#191919",
  airtable: "#fcb400",
  postgres: "#336791",
  mysql: "#00758f",
  hubspot: "#ff7a59",
  github: "#1f2328",
  jira: "#2684ff",
  webhook: "#c73a63",
  http: "#5a5cf0",
  /*
   * MCP is a specification, not a company, so there is no brand kit to be
   * faithful to. This is the protocol's own documentation colour, kept here
   * with the trademarks rather than in tokens for the same reason as the rest:
   * it is a fixed vendor-ish value, not a hue Ink & Iris gets to theme.
   */
  mcp: "#7a5af0",

  /* Vendors reached through their own MCP server rather than an adapter we
     wrote. Recognised, never offered — see `ProviderId`. */
  grafana: "#f46800",
  servicenow: "#62d84e",
  datadog: "#632ca6",
  sentry: "#362d59",
  linear: "#5e6ad2",
  stripe: "#635bff",
  snowflake: "#29b5e8",
  pagerduty: "#06ac38",
  zendesk: "#03363d",
  salesforce: "#00a1e0",
  gitlab: "#fc6d26",
  confluence: "#2684ff",
  mongodb: "#00ed64",
  elastic: "#fec514",
  shopify: "#95bf47",
  twilio: "#f22f46",
  kubernetes: "#326ce5",
  aws: "#ff9900",
};

/**
 * Marks that are too dark to read as themselves on a dark canvas.
 *
 * A brand colour is fixed by its owner, and several are chosen for print or for
 * a white page — Sentry's ink and Zendesk's near-black both disappear against
 * `--bg-raised`. Lightening them is not a theming decision we are making about
 * somebody else's trademark; it is the minimum needed for the mark to be
 * visible at all, which every brand kit's own dark-background guidance does
 * too. Applied only in dark, and only to these.
 */
export const PROVIDER_DARK_COLOUR: Partial<Record<ProviderId, string>> = {
  sentry: "#8d7ad6",
  zendesk: "#3ec6d4",
  notion: "#e8e8e6",
  github: "#e6edf3",
  anthropic: "#e08f6c",
};
