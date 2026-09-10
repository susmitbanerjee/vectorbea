package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.ConnectionRepository
import java.math.BigDecimal
import java.util.UUID
import javax.sql.DataSource

/**
 * What this customer actually pays for a model on this connection.
 *
 * ── WHY A LIST PRICE IS THE WRONG NUMBER FOR AN ENTERPRISE ──────────────────
 * The platform's price table is a `when` over model-name substrings. That is
 * right for a self-serve customer on published rates and wrong for everybody
 * this exists for: an enterprise is on a negotiated agreement, frequently on
 * committed spend, and often running their own gateway in front of a model we
 * have never heard of and could not price if we tried.
 *
 * The failure is not abstract. The first thing a finance team does with a cost
 * dashboard is reconcile it against the provider invoice. If our figure is
 * higher — and applying list price to a discounted contract always is — the
 * conclusion is not "their pricing table is stale", it is "the platform is more
 * expensive than they said".
 *
 * ── THIS IS NOT BILLING ─────────────────────────────────────────────────────
 * Nothing here charges anybody. These rates feed cost ATTRIBUTION: the number on
 * a run, the number a budget ceiling is measured against, the number on the
 * dashboard. The platform's own invoice comes from `billing_accounts`, which
 * this cannot reach — invariant 13 keeps billing off every read path, and a
 * customer-editable rate has no business anywhere near it.
 */
class ConnectionPriceRoutes(
    private val dataSource: DataSource,
    private val connections: ConnectionRepository,
    private val audit: com.vectorbea.api.audit.AuditLog? = null,
) {

    fun register(router: Router) {
        router.get("/api/connections/:id/prices", ::list)
        router.put("/api/connections/:id/prices", ::upsert)
        router.delete("/api/connections/:id/prices/:priceId", ::remove)
    }

    private data class PriceBody(
        /** An exact model name, or a prefix ending in `*`. */
        val model: String? = null,
        val inputUsdPerMillion: Double? = null,
        val outputUsdPerMillion: Double? = null,
        /** Absent means "use the provider's own published cache multiplier". */
        val cachedInputUsdPerMillion: Double? = null,
        val currency: String? = null,
        val note: String? = null,
    )

    /** The connection, or a 404. Scoped to the workspace at the same boundary as everything else. */
    private fun requireConnection(req: Request, id: UUID) =
        connections.findById(id, req.context().workspaceId)
            ?: throw ApiError.NotFound("Connection")

    private fun list(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        requireConnection(req, id)

        val rows = dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT id, model_pattern, input_usd_per_million, output_usd_per_million,
                          cached_input_usd_per_million, currency, note, updated_at
                     FROM connection_model_prices
                    WHERE connection_id = ? AND workspace_id = ?
                    ORDER BY model_pattern"""
            ).use { st ->
                st.setObject(1, id); st.setObject(2, ctx.workspaceId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(mapOf(
                            "id" to rs.getObject("id", UUID::class.java).toString(),
                            "model" to rs.getString("model_pattern"),
                            "inputUsdPerMillion" to rs.getBigDecimal("input_usd_per_million").toDouble(),
                            "outputUsdPerMillion" to rs.getBigDecimal("output_usd_per_million").toDouble(),
                            "cachedInputUsdPerMillion" to
                                rs.getBigDecimal("cached_input_usd_per_million")?.toDouble(),
                            "currency" to rs.getString("currency"),
                            "note" to rs.getString("note"),
                            "updatedAt" to rs.getTimestamp("updated_at").toInstant().toString(),
                        ))
                    }
                }
            }
        }
        return Response.ok(mapOf("items" to rows, "total" to rows.size))
    }

    /**
     * Set the rate for one model. Idempotent on `(connection, model)`.
     *
     * PUT rather than POST because a negotiated rate is a fact about a contract,
     * not an event: sending it twice must leave one row, and a customer
     * re-running their setup script should not accumulate duplicate rates whose
     * symptom is "the cost changes depending on which row was read first".
     */
    private fun upsert(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val conn = requireConnection(req, id)
        val body = req.bodyAs<PriceBody>()

        val model = requireField(body.model, "model").trim()
        if (model.isEmpty() || model.length > MAX_PATTERN_LENGTH) {
            throw ApiError.ValidationError(
                "`model` must be between 1 and $MAX_PATTERN_LENGTH characters. It is an exact " +
                    "model name, or a prefix ending in `*` — a contract is usually quoted per " +
                    "model family, and `gpt-4o*` saves enumerating every point release."
            )
        }
        if (model.count { it == '*' } > 1 || (model.contains('*') && !model.endsWith('*'))) {
            throw ApiError.ValidationError(
                "`model` may end in a single `*`, or contain none at all. A pattern with a " +
                    "wildcard in the middle looks like it works and quietly matches nothing."
            )
        }

        val input = requirePrice(body.inputUsdPerMillion, "inputUsdPerMillion")
        val output = requirePrice(body.outputUsdPerMillion, "outputUsdPerMillion")
        val cached = body.cachedInputUsdPerMillion?.also { validatePrice(it, "cachedInputUsdPerMillion") }

        /*
         * ── THE CURRENCY REFUSAL IS DELIBERATE ──────────────────────────────
         * Every downstream number — budgets, ceilings, the usage ledger, the
         * dashboard — is USD. Accepting a EUR rate without an FX rate and a
         * conversion date would silently misprice the customer's entire history
         * by whatever the pair moved. Refusing says so; converting at an
         * invented rate would not.
         */
        val currency = (body.currency ?: "USD").uppercase()
        if (currency != "USD") {
            throw ApiError.ValidationError(
                "Rates must be given in USD. Every cost figure in the platform — budgets, " +
                    "ceilings, the usage ledger — is USD, and converting a $currency rate " +
                    "without a stated FX rate and date would misprice your whole history by " +
                    "whatever the pair moved. Convert the rate and record the date in `note`."
            )
        }

        val priceId = dataSource.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO connection_model_prices
                     (workspace_id, connection_id, model_pattern, input_usd_per_million,
                      output_usd_per_million, cached_input_usd_per_million, currency, note,
                      created_by_user_id)
                   VALUES (?,?,?,?,?,?,?,?,?)
                   ON CONFLICT (connection_id, model_pattern) DO UPDATE SET
                     input_usd_per_million = EXCLUDED.input_usd_per_million,
                     output_usd_per_million = EXCLUDED.output_usd_per_million,
                     cached_input_usd_per_million = EXCLUDED.cached_input_usd_per_million,
                     note = EXCLUDED.note,
                     updated_at = now()
                   RETURNING id"""
            ).use { st ->
                st.setObject(1, ctx.workspaceId)
                st.setObject(2, id)
                st.setString(3, model)
                st.setBigDecimal(4, BigDecimal.valueOf(input))
                st.setBigDecimal(5, BigDecimal.valueOf(output))
                if (cached == null) st.setNull(6, java.sql.Types.NUMERIC)
                else st.setBigDecimal(6, BigDecimal.valueOf(cached))
                st.setString(7, currency)
                st.setString(8, body.note?.take(MAX_NOTE_LENGTH))
                st.setObject(9, req.principal?.appUserId)
                st.executeQuery().use { rs -> rs.next(); rs.getObject("id", UUID::class.java) }
            }
        }

        /* A rate change moves every cost figure this connection produces from
           here on. Who changed it, and to what, is the question asked when the
           dashboard and the invoice stop agreeing. */
        audit?.recordUserAction(
            req, ctx.workspaceId,
            com.vectorbea.api.audit.AuditLog.Action.CONNECTION_UPDATE,
            targetType = "connection_price", targetId = priceId,
            environmentId = conn.environmentId,
            after = mapOf(
                "connectionId" to id.toString(), "model" to model,
                "inputUsdPerMillion" to input, "outputUsdPerMillion" to output,
            ),
        )

        return Response.ok(mapOf(
            "id" to priceId.toString(),
            "model" to model,
            "inputUsdPerMillion" to input,
            "outputUsdPerMillion" to output,
            "cachedInputUsdPerMillion" to cached,
            "currency" to currency,
            "message" to "Model calls on this connection are now priced at your rate. Costs " +
                "already recorded are unchanged — they were computed at the rate in force when " +
                "the call was made.",
        ))
    }

    private fun remove(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val priceId = req.pathUUID("priceId")
        val conn = requireConnection(req, id)

        val deleted = dataSource.connection.use { c ->
            c.prepareStatement(
                "DELETE FROM connection_model_prices WHERE id = ? AND connection_id = ? " +
                    "AND workspace_id = ?"
            ).use { st ->
                st.setObject(1, priceId); st.setObject(2, id); st.setObject(3, ctx.workspaceId)
                st.executeUpdate() > 0
            }
        }
        if (!deleted) throw ApiError.NotFound("Price")

        audit?.recordUserAction(
            req, ctx.workspaceId,
            com.vectorbea.api.audit.AuditLog.Action.CONNECTION_UPDATE,
            targetType = "connection_price", targetId = priceId,
            environmentId = conn.environmentId,
            before = mapOf("connectionId" to id.toString()),
        )
        return Response.noContent()
    }

    private fun requirePrice(value: Double?, field: String): Double {
        val v = value ?: throw ApiError.ValidationError(
            "`$field` is required. A contract quotes input and output separately because " +
                "output costs three to five times more, and a single blended rate is only " +
                "correct at one particular ratio."
        )
        validatePrice(v, field)
        return v
    }

    private fun validatePrice(value: Double, field: String) {
        if (value.isNaN() || value.isInfinite() || value < 0) {
            throw ApiError.ValidationError("`$field` must be a number of USD per million tokens, zero or above.")
        }
        if (value > MAX_USD_PER_MILLION) {
            /* Not a limit on what anybody may charge — a guard against a decimal
               point in the wrong place, which is silent and multiplies every cost
               figure by a thousand. */
            throw ApiError.ValidationError(
                "`$field` is $value USD per million tokens, which is far above any published " +
                    "rate. If that is genuinely your rate, the field is per MILLION tokens — " +
                    "check the decimal point."
            )
        }
    }

    private companion object {
        const val MAX_PATTERN_LENGTH = 200
        const val MAX_NOTE_LENGTH = 500

        /** An order of magnitude above the most expensive published model. */
        const val MAX_USD_PER_MILLION = 10_000.0
    }
}
