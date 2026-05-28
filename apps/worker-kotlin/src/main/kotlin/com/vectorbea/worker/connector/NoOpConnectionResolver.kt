package com.vectorbea.worker.connector

import java.io.PrintWriter
import java.sql.Connection
import java.util.logging.Logger
import javax.sql.DataSource

/**
 * Fallback [ConnectionResolver] used when no real resolver is wired (e.g. in tests
 * that only exercise non-connector node types).
 *
 * Uses a DataSource that always throws on [getConnection], so any attempt to
 * resolve a connection will fail with a [ConnectionException] ("Connection not found").
 */
val NoOpConnectionResolver: ConnectionResolver = ConnectionResolver(
    dataSource    = NoOpDataSource,
    secretService = SecretService(keyBase64 = null, dataSource = NoOpDataSource),
)

private object NoOpDataSource : DataSource {
    override fun getConnection(): Connection = throw UnsupportedOperationException("NoOpDataSource")
    override fun getConnection(u: String?, p: String?): Connection = throw UnsupportedOperationException("NoOpDataSource")
    override fun getLogWriter(): PrintWriter? = null
    override fun setLogWriter(out: PrintWriter?) {}
    override fun setLoginTimeout(seconds: Int) {}
    override fun getLoginTimeout(): Int = 0
    override fun getParentLogger(): Logger = Logger.getLogger("noop")
    override fun <T : Any?> unwrap(iface: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(iface: Class<*>?): Boolean = false
}
