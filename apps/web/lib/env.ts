/**
 * Public (client-safe) environment helpers.
 *
 * VECTORBEA_ENV is the data tag that segments prod vs non-prod deployments. It is
 * exposed to the browser via NEXT_PUBLIC_VECTORBEA_ENV (set per Vercel/Railway
 * environment). Staging runs with VECTORBEA_ENV=dev, production with
 * VECTORBEA_ENV=prod — see docs/deployment/dev-staging-prod.md.
 */
export const VECTORBEA_ENV = (process.env.NEXT_PUBLIC_VECTORBEA_ENV ?? "dev").toLowerCase();

/** True only in the production deployment. */
export const IS_PROD_ENV = VECTORBEA_ENV === "prod" || VECTORBEA_ENV === "production";

/**
 * Short label for the non-prod environment badge, or `null` in production.
 * The badge is intentionally hidden in prod so customers never see a "Dev" tag.
 */
export function envBadgeLabel(): string | null {
  if (IS_PROD_ENV) return null;
  if (VECTORBEA_ENV === "staging") return "Staging";
  return "Dev";
}
