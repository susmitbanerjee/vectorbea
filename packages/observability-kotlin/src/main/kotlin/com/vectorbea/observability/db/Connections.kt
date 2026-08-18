package com.vectorbea.observability.db

import java.sql.Connection
import javax.sql.DataSource

/**
 * The library borrows a DataSource; it never owns one.
 *
 * `apps/telemetry` opened its own Hikari pool because it was its own process. Inside
 * the API or the worker that would mean two pools from one JVM against one Postgres —
 * each sized as though it were alone, together exceeding the connection budget in §2.7,
 * and each looking innocent in isolation. Analytics writes go through the host's pool
 * and compete for its connections, which is the honest arrangement: they are not free
 * and should not be able to pretend otherwise.
 */
fun <T> DataSource.withConnection(block: (Connection) -> T): T = connection.use(block)
