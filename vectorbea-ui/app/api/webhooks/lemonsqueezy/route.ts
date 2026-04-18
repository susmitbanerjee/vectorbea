/**
 * Legacy Lemon Squeezy webhook endpoint.
 *
 * All subscription lifecycle logic now lives in the unified billing handler:
 *   POST /api/webhooks/billing
 *
 * This route is kept for backwards compatibility with any existing webhook
 * registrations and simply forwards to the unified handler internally.
 * New webhook registrations should point directly at /api/webhooks/billing.
 */
export { POST, runtime, dynamic } from "@/app/api/webhooks/billing/route";
