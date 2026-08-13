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
};
