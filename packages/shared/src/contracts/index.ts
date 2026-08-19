/**
 * Vectorbea API contracts.
 *
 * Zod schemas are the SOURCE OF TRUTH; the TypeScript types are `z.infer`ed
 * from them. That is deliberate — a hand-written type plus a hand-written
 * schema is two things to keep in sync, and the pair drifts the first time
 * someone edits one of them.
 *
 * These are transcribed by hand from the Kotlin route handlers because the API
 * has no OpenAPI spec and cannot cheaply produce one (see `primitives.ts` and
 * docs/integration/API-GAPS.md). Transcription drifts, which is precisely why
 * every response is validated against these at the transport boundary rather
 * than merely typed as them.
 */

export * from "./primitives";
export * from "./run";
export * from "./registry";
export * from "./operations";
