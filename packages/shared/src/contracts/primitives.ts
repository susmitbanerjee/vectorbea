import { z } from "zod";

/**
 * Shared primitives for the API contracts.
 *
 * WHY THESE ARE HAND-WRITTEN
 * ──────────────────────────
 * `apps/api-kotlin` has no OpenAPI spec, and generating one is not currently
 * cheap: the service runs on the JDK's built-in `com.sun.net.httpserver` with a
 * hand-rolled router, and every response is assembled as an untyped
 * `mapOf("id" to id.toString(), …)`. There is no framework to introspect and no
 * typed DTO to reflect over, so a generator would have nothing to read.
 *
 * These schemas are therefore transcribed from the `toResponse()` functions in
 * `apps/api-kotlin/src/main/kotlin/com/vectorbea/api/routes/*.kt`. That makes
 * them a hand-maintained mirror, which is exactly the thing that drifts — so
 * they are enforced at runtime at the transport boundary rather than trusted.
 * A drift shows up as one `contract_mismatch` error naming the field, instead of
 * `undefined is not an object` five components deep.
 *
 * See docs/integration/API-GAPS.md for the OpenAPI recommendation and its cost.
 */

/**
 * The API stringifies every UUID (`id.toString()`), so these arrive as strings.
 * Validated as UUIDs rather than plain strings because a route that returns a
 * slug where the UI expects an id is a bug worth catching at the boundary.
 */
export const uuid = z.string().uuid();

/**
 * Kotlin `Instant.toString()` / `OffsetDateTime.toString()` — ISO-8601.
 *
 * Deliberately NOT `z.string().datetime()`: that rejects the offset forms
 * Postgres `timestamptz` produces through JDBC (`2026-08-19T14:20:00+01:00`),
 * and rejecting a valid timestamp is worse than accepting a loose one.
 */
export const isoDateTime = z.string().min(1);

/**
 * A field the API OMITS when it is null.
 *
 * `http/Json.kt` configures the response mapper with
 * `JsonInclude.Include.NON_NULL`, so a null never reaches the wire as
 * `"field": null` — the key is simply absent. `.nullable()` therefore describes
 * something this API never sends: it permits null and still requires the key,
 * so the first row with a null in that column fails validation and takes the
 * whole response — every other row with it — down as `contract_mismatch`.
 *
 * That is not hypothetical. `workflow.currentVersionId` was `uuid.nullable()`,
 * and a workflow has no current version between its creation and its first
 * version being written — so creating a workflow made `GET /api/workflows`
 * unparseable for the entire list.
 *
 * Accepts absent OR explicit null, and normalises both to `null`. Consumers
 * keep the single `T | null` they already handle: "the key was missing" and
 * "the value was null" are the same fact about the row, and making screens
 * distinguish them would be inventing a difference the database does not have.
 *
 * Use this for every nullable column. Reach for `.nullable()` only where the
 * API is known to emit an explicit null — which, while the mapper is NON_NULL,
 * is nowhere.
 */
export function maybe<T extends z.ZodTypeAny>(schema: T) {
  return schema.nullish().transform((value) => value ?? null);
}

/** Arbitrary JSON the API passes through from a `jsonb` column. */
export const jsonObject = z.record(z.string(), z.unknown());

/**
 * Numeric columns arrive as JSON numbers, but Jackson renders Postgres
 * `numeric` as a number and nulls stay null. Coerced because a cost of `0`
 * versus `"0"` should not be a contract failure.
 */
export const money = z.coerce.number();

/**
 * The paginated envelope every list endpoint returns
 * (`repository/Page.kt`). Note `page`/`pageSize`, NOT `limit`/`cursor`.
 */
export function page<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  });
}

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * The error envelope (`errors/ErrorResponse.kt`).
 *
 * Parsed leniently on purpose: an error response that fails validation would
 * mask the actual error with a contract failure, which is the least useful
 * possible substitution.
 */
export const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: jsonObject.nullish(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelope>;
