package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowGraph
import com.vectorbea.worker.runtime.graph.WorkflowNode
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.sql.*
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertIs

class DbReadNodeExecutorTest {

    private val workspaceId   = UUID.randomUUID()
    private val runId         = UUID.randomUUID()
    private val environmentId = UUID.randomUUID()
    private val versionId     = UUID.randomUUID()

    private fun context() = RuntimeContext(
        runId             = runId,
        workspaceId       = workspaceId,
        environmentId     = environmentId,
        workflowVersionId = versionId,
        workflowInput     = emptyMap(),
        graph             = WorkflowGraph(),
    )

    private fun stubEventStore() = object : RunEventStore(noopDs(), noopPubSub()) {
        override fun appendEvent(event: RunEvent): Int = 0
    }

    private fun connectionRecord(
        allowedTables: List<String> = emptyList(),
    ) = ConnectionRecord(
        id             = UUID.randomUUID(),
        workspaceId    = workspaceId,
        environmentId  = environmentId,
        name           = "test-db",
        type           = "database",
        provider       = "postgresql",
        status         = "active",
        authType       = "basic",
        secretRef      = null,
        configJson     = emptyMap(),
        allowedHosts   = emptyList(),
        allowedPaths   = emptyList(),
        allowedSchemas = emptyList(),
        allowedTables  = allowedTables,
    )

    private fun stubResolver(record: ConnectionRecord): ConnectionResolver =
        object : ConnectionResolver(noopDs(), noopSecretService()) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                ResolvedConnection(record = record, secret = null)
        }

    // ── Query validation ──────────────────────────────────────────────────────

    @Test
    fun `rejects INSERT statement`() {
        val executor = DbReadNodeExecutor(stubResolver(connectionRecord()), StubPoolManager(), stubEventStore())
        val node = WorkflowNode(id = "n1", type = "db_query",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "query"        to "INSERT INTO users VALUES (1, 'x')",
            ))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("SELECT"))
    }

    @Test
    fun `rejects UPDATE statement`() {
        val executor = DbReadNodeExecutor(stubResolver(connectionRecord()), StubPoolManager(), stubEventStore())
        val node = WorkflowNode(id = "n1", type = "db_query",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "query"        to "UPDATE users SET name = 'x'",
            ))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
    }

    @Test
    fun `rejects multi-statement SQL`() {
        val executor = DbReadNodeExecutor(stubResolver(connectionRecord()), StubPoolManager(), stubEventStore())
        val node = WorkflowNode(id = "n1", type = "db_query",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "query"        to "SELECT 1; DROP TABLE users",
            ))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("multi-statement"))
    }

    @Test
    fun `rejects query referencing non-allowed table`() {
        val record   = connectionRecord(allowedTables = listOf("orders"))
        val executor = DbReadNodeExecutor(stubResolver(record), StubPoolManager(), stubEventStore())
        val node = WorkflowNode(id = "n1", type = "db_query",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "query"        to "SELECT * FROM secret_data",
            ))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("allowedTables"))
    }

    @Test
    fun `accepts SELECT query when table in allowedTables`() {
        val record   = connectionRecord(allowedTables = listOf("users"))
        // Use a pool manager that returns in-memory rows
        val rows     = listOf(mapOf("id" to 1, "name" to "Alice"))
        val pm       = StubPoolManager(rows)
        val executor = DbReadNodeExecutor(stubResolver(record), pm, stubEventStore())
        val node = WorkflowNode(id = "n1", type = "db_query",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "query"        to "SELECT id, name FROM users WHERE id = ?",
                "params"       to listOf(1),
            ))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        @Suppress("UNCHECKED_CAST")
        val resultRows = (result as NodeResult.Completed).output["rows"] as List<*>
        assertEquals(1, resultRows.size)
    }

    // ── Missing connectionId ──────────────────────────────────────────────────

    @Test
    fun `returns Failed when connectionId missing`() {
        val executor = DbReadNodeExecutor(stubResolver(connectionRecord()), StubPoolManager(), stubEventStore())
        val node = WorkflowNode(id = "n1", type = "db_query",
            config = mapOf("query" to "SELECT 1"))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("connectionId"))
    }

    // ── Missing query ─────────────────────────────────────────────────────────

    @Test
    fun `returns Failed when query missing`() {
        val executor = DbReadNodeExecutor(stubResolver(connectionRecord()), StubPoolManager(), stubEventStore())
        val node = WorkflowNode(id = "n1", type = "db_query",
            config = mapOf("connectionId" to UUID.randomUUID().toString()))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("query"))
    }
}

// ── Stub pool manager that returns a fixed result set ─────────────────────────

private class StubPoolManager(
    private val rows: List<Map<String, Any>> = emptyList(),
) : ClientDbPoolManager() {
    override fun getOrCreate(
        record: ConnectionRecord,
        secret: com.vectorbea.worker.connector.SecretValue?,
    ): DataSource = StubDataSource(rows)
}

private class StubDataSource(private val rows: List<Map<String, Any>>) : DataSource {
    override fun getConnection(): Connection = StubConnection(rows)
    override fun getConnection(u: String?, p: String?): Connection = StubConnection(rows)
    override fun getLogWriter(): java.io.PrintWriter? = null
    override fun setLogWriter(out: java.io.PrintWriter?) {}
    override fun setLoginTimeout(s: Int) {}
    override fun getLoginTimeout() = 0
    override fun getParentLogger() = java.util.logging.Logger.getLogger("noop")
    override fun <T : Any?> unwrap(c: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(c: Class<*>?) = false
}

private class StubConnection(private val rows: List<Map<String, Any>>) : Connection {
    private var readOnly = false
    override fun isReadOnly() = readOnly
    override fun setReadOnly(r: Boolean) { readOnly = r }
    override fun prepareStatement(sql: String): PreparedStatement = StubPreparedStatement(rows)
    override fun close() {}
    override fun isClosed() = false
    override fun getAutoCommit() = true
    override fun setAutoCommit(a: Boolean) {}
    override fun commit() {}
    override fun rollback() {}
    override fun getMetaData(): DatabaseMetaData = throw UnsupportedOperationException()
    override fun setTransactionIsolation(level: Int) {}
    override fun getTransactionIsolation() = Connection.TRANSACTION_READ_COMMITTED
    override fun getWarnings(): SQLWarning? = null
    override fun clearWarnings() {}
    override fun setCatalog(catalog: String?) {}
    override fun getCatalog(): String? = null
    override fun createStatement(): Statement = throw UnsupportedOperationException()
    override fun prepareCall(sql: String): CallableStatement = throw UnsupportedOperationException()
    override fun nativeSQL(sql: String) = sql
    override fun setHoldability(h: Int) {}
    override fun getHoldability() = ResultSet.HOLD_CURSORS_OVER_COMMIT
    override fun setSavepoint(): Savepoint = throw UnsupportedOperationException()
    override fun setSavepoint(name: String?): Savepoint = throw UnsupportedOperationException()
    override fun rollback(savepoint: Savepoint?) {}
    override fun releaseSavepoint(savepoint: Savepoint?) {}
    override fun createStatement(rt: Int, rc: Int): Statement = throw UnsupportedOperationException()
    override fun prepareStatement(sql: String, rt: Int, rc: Int): PreparedStatement = StubPreparedStatement(rows)
    override fun prepareCall(sql: String, rt: Int, rc: Int): CallableStatement = throw UnsupportedOperationException()
    override fun getTypeMap(): MutableMap<String, Class<*>> = mutableMapOf()
    override fun setTypeMap(map: MutableMap<String, Class<*>>?) {}
    override fun createStatement(rt: Int, rc: Int, rh: Int): Statement = throw UnsupportedOperationException()
    override fun prepareStatement(sql: String, rt: Int, rc: Int, rh: Int): PreparedStatement = StubPreparedStatement(rows)
    override fun prepareCall(sql: String, rt: Int, rc: Int, rh: Int): CallableStatement = throw UnsupportedOperationException()
    override fun prepareStatement(sql: String, ak: Int): PreparedStatement = StubPreparedStatement(rows)
    override fun prepareStatement(sql: String, columnIndexes: IntArray?): PreparedStatement = StubPreparedStatement(rows)
    override fun prepareStatement(sql: String, columnNames: Array<String>?): PreparedStatement = StubPreparedStatement(rows)
    override fun createClob(): java.sql.Clob = throw UnsupportedOperationException()
    override fun createBlob(): java.sql.Blob = throw UnsupportedOperationException()
    override fun createNClob(): java.sql.NClob = throw UnsupportedOperationException()
    override fun createSQLXML(): java.sql.SQLXML = throw UnsupportedOperationException()
    override fun isValid(timeout: Int) = true
    override fun setClientInfo(name: String?, value: String?) {}
    override fun setClientInfo(properties: java.util.Properties?) {}
    override fun getClientInfo(name: String?): String? = null
    override fun getClientInfo(): java.util.Properties = java.util.Properties()
    override fun createArrayOf(typeName: String?, elements: Array<out Any?>?): java.sql.Array = throw UnsupportedOperationException()
    override fun createStruct(typeName: String?, attributes: Array<out Any?>?): Struct = throw UnsupportedOperationException()
    override fun setSchema(schema: String?) {}
    override fun getSchema(): String? = null
    override fun abort(executor: java.util.concurrent.Executor?) {}
    override fun setNetworkTimeout(executor: java.util.concurrent.Executor?, milliseconds: Int) {}
    override fun getNetworkTimeout() = 0
    override fun <T : Any?> unwrap(iface: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(iface: Class<*>?) = false
}

private class StubPreparedStatement(private val rows: List<Map<String, Any>>) : PreparedStatement {
    override fun executeQuery(): ResultSet = StubResultSet(rows)
    override fun executeUpdate(): Int = 0
    override fun setObject(idx: Int, x: Any?) {}
    override fun setQueryTimeout(seconds: Int) {}
    override fun getQueryTimeout() = 0
    override fun setMaxRows(max: Int) {}
    override fun getMaxRows() = 0
    override fun close() {}
    override fun execute(): Boolean = false
    override fun getResultSet(): ResultSet? = null
    override fun getUpdateCount() = -1
    override fun getMoreResults() = false
    override fun setFetchDirection(d: Int) {}
    override fun getFetchDirection() = ResultSet.FETCH_FORWARD
    override fun setFetchSize(r: Int) {}
    override fun getFetchSize() = 0
    override fun getResultSetConcurrency() = ResultSet.CONCUR_READ_ONLY
    override fun getResultSetType() = ResultSet.TYPE_FORWARD_ONLY
    override fun addBatch() {}
    override fun clearBatch() {}
    override fun executeBatch(): IntArray = IntArray(0)
    override fun getConnection(): Connection = throw UnsupportedOperationException()
    override fun getMoreResults(current: Int) = false
    override fun getGeneratedKeys(): ResultSet = throw UnsupportedOperationException()
    override fun executeUpdate(sql: String?, flag: Int) = 0
    override fun executeUpdate(sql: String?, ids: IntArray?) = 0
    override fun executeUpdate(sql: String?, names: Array<String>?) = 0
    override fun execute(sql: String?) = false
    override fun execute(sql: String?, flag: Int) = false
    override fun execute(sql: String?, ids: IntArray?) = false
    override fun execute(sql: String?, names: Array<String>?) = false
    override fun getResultSetHoldability() = ResultSet.HOLD_CURSORS_OVER_COMMIT
    override fun isClosed() = false
    override fun setPoolable(p: Boolean) {}
    override fun isPoolable() = false
    override fun closeOnCompletion() {}
    override fun isCloseOnCompletion() = false
    override fun <T : Any?> unwrap(c: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(c: Class<*>?) = false
    override fun getWarnings(): SQLWarning? = null
    override fun clearWarnings() {}
    override fun setCursorName(name: String?) {}
    override fun getMaxFieldSize() = 0
    override fun setMaxFieldSize(max: Int) {}
    override fun setEscapeProcessing(enable: Boolean) {}
    override fun cancel() {}
    override fun executeQuery(sql: String?): ResultSet = StubResultSet(rows)
    override fun executeUpdate(sql: String?) = 0
    override fun addBatch(sql: String?) {}
    override fun setNull(idx: Int, sqlType: Int) {}
    override fun setBoolean(idx: Int, x: Boolean) {}
    override fun setByte(idx: Int, x: Byte) {}
    override fun setShort(idx: Int, x: Short) {}
    override fun setInt(idx: Int, x: Int) {}
    override fun setLong(idx: Int, x: Long) {}
    override fun setFloat(idx: Int, x: Float) {}
    override fun setDouble(idx: Int, x: Double) {}
    override fun setBigDecimal(idx: Int, x: java.math.BigDecimal?) {}
    override fun setString(idx: Int, x: String?) {}
    override fun setBytes(idx: Int, x: ByteArray?) {}
    override fun setDate(idx: Int, x: java.sql.Date?) {}
    override fun setTime(idx: Int, x: Time?) {}
    override fun setTimestamp(idx: Int, x: Timestamp?) {}
    override fun setAsciiStream(idx: Int, x: java.io.InputStream?, length: Int) {}
    @Suppress("DEPRECATION")
    override fun setUnicodeStream(idx: Int, x: java.io.InputStream?, length: Int) {}
    override fun setBinaryStream(idx: Int, x: java.io.InputStream?, length: Int) {}
    override fun clearParameters() {}
    override fun setObject(idx: Int, x: Any?, targetSqlType: Int) {}
    override fun setCharacterStream(idx: Int, reader: java.io.Reader?, length: Int) {}
    override fun setRef(idx: Int, x: Ref?) {}
    override fun setBlob(idx: Int, x: java.sql.Blob?) {}
    override fun setClob(idx: Int, x: java.sql.Clob?) {}
    override fun setArray(idx: Int, x: java.sql.Array?) {}
    override fun getMetaData(): ResultSetMetaData = throw UnsupportedOperationException()
    override fun setDate(idx: Int, x: java.sql.Date?, cal: java.util.Calendar?) {}
    override fun setTime(idx: Int, x: Time?, cal: java.util.Calendar?) {}
    override fun setTimestamp(idx: Int, x: Timestamp?, cal: java.util.Calendar?) {}
    override fun setNull(idx: Int, sqlType: Int, typeName: String?) {}
    override fun setURL(idx: Int, x: java.net.URL?) {}
    override fun getParameterMetaData(): ParameterMetaData = throw UnsupportedOperationException()
    override fun setRowId(idx: Int, x: RowId?) {}
    override fun setNString(idx: Int, value: String?) {}
    override fun setNCharacterStream(idx: Int, value: java.io.Reader?, length: Long) {}
    override fun setNClob(idx: Int, value: java.sql.NClob?) {}
    override fun setClob(idx: Int, reader: java.io.Reader?, length: Long) {}
    override fun setBlob(idx: Int, inputStream: java.io.InputStream?, length: Long) {}
    override fun setNClob(idx: Int, reader: java.io.Reader?, length: Long) {}
    override fun setSQLXML(idx: Int, xmlObject: java.sql.SQLXML?) {}
    override fun setObject(idx: Int, x: Any?, targetSqlType: Int, scaleOrLength: Int) {}
    override fun setAsciiStream(idx: Int, x: java.io.InputStream?, length: Long) {}
    override fun setBinaryStream(idx: Int, x: java.io.InputStream?, length: Long) {}
    override fun setCharacterStream(idx: Int, reader: java.io.Reader?, length: Long) {}
    override fun setAsciiStream(idx: Int, x: java.io.InputStream?) {}
    override fun setBinaryStream(idx: Int, x: java.io.InputStream?) {}
    override fun setCharacterStream(idx: Int, reader: java.io.Reader?) {}
    override fun setNCharacterStream(idx: Int, value: java.io.Reader?) {}
    override fun setClob(idx: Int, reader: java.io.Reader?) {}
    override fun setBlob(idx: Int, inputStream: java.io.InputStream?) {}
    override fun setNClob(idx: Int, reader: java.io.Reader?) {}
}

private class StubResultSet(private val rows: List<Map<String, Any>>) : ResultSet {
    private var cursor = -1
    private val colNames = rows.firstOrNull()?.keys?.toList() ?: emptyList()

    override fun next(): Boolean {
        cursor++
        return cursor < rows.size
    }

    override fun getObject(columnIndex: Int): Any? = rows[cursor][colNames[columnIndex - 1]]
    override fun getObject(columnLabel: String?): Any? = rows[cursor][columnLabel]
    override fun getMetaData(): ResultSetMetaData = object : ResultSetMetaData {
        override fun getColumnCount() = colNames.size
        override fun getColumnLabel(column: Int) = colNames[column - 1]
        override fun getColumnName(column: Int) = colNames[column - 1]
        override fun getColumnType(column: Int) = Types.OTHER
        override fun getColumnTypeName(column: Int) = "unknown"
        override fun getColumnClassName(column: Int) = "java.lang.Object"
        override fun getColumnDisplaySize(column: Int) = 0
        override fun getPrecision(column: Int) = 0
        override fun getScale(column: Int) = 0
        override fun getTableName(column: Int) = ""
        override fun getSchemaName(column: Int) = ""
        override fun getCatalogName(column: Int) = ""
        override fun isAutoIncrement(column: Int) = false
        override fun isCaseSensitive(column: Int) = false
        override fun isSearchable(column: Int) = false
        override fun isCurrency(column: Int) = false
        override fun isNullable(column: Int) = ResultSetMetaData.columnNullable
        override fun isSigned(column: Int) = false
        override fun isReadOnly(column: Int) = true
        override fun isWritable(column: Int) = false
        override fun isDefinitelyWritable(column: Int) = false
        override fun <T : Any?> unwrap(c: Class<T>?): T = throw UnsupportedOperationException()
        override fun isWrapperFor(c: Class<*>?) = false
    }

    override fun close() {}
    override fun wasNull() = false
    override fun isClosed() = cursor >= rows.size
    override fun getString(idx: Int): String? = rows[cursor][colNames[idx - 1]]?.toString()
    override fun getString(label: String?): String? = rows[cursor][label]?.toString()
    override fun getInt(idx: Int): Int = (rows[cursor][colNames[idx - 1]] as? Number)?.toInt() ?: 0
    override fun getLong(idx: Int): Long = (rows[cursor][colNames[idx - 1]] as? Number)?.toLong() ?: 0L
    // All other getters can throw — tests don't use them
    override fun getBoolean(idx: Int) = false
    override fun getByte(idx: Int): Byte = 0
    override fun getShort(idx: Int): Short = 0
    override fun getFloat(idx: Int) = 0f
    override fun getDouble(idx: Int) = 0.0
    @Suppress("DEPRECATION")
    override fun getBigDecimal(idx: Int, scale: Int): java.math.BigDecimal? = null
    override fun getBytes(idx: Int): ByteArray? = null
    override fun getDate(idx: Int): java.sql.Date? = null
    override fun getTime(idx: Int): java.sql.Time? = null
    override fun getTimestamp(idx: Int): java.sql.Timestamp? = null
    override fun getAsciiStream(idx: Int): java.io.InputStream? = null
    @Suppress("DEPRECATION")
    override fun getUnicodeStream(idx: Int): java.io.InputStream? = null
    override fun getBinaryStream(idx: Int): java.io.InputStream? = null
    override fun getWarnings(): java.sql.SQLWarning? = null
    override fun clearWarnings() {}
    override fun getCursorName(): String? = null
    override fun getCharacterStream(idx: Int): java.io.Reader? = null
    override fun getBigDecimal(idx: Int): java.math.BigDecimal? = null
    override fun isBeforeFirst() = cursor < 0
    override fun isAfterLast() = cursor >= rows.size
    override fun isFirst() = cursor == 0
    override fun isLast() = cursor == rows.size - 1
    override fun beforeFirst() { cursor = -1 }
    override fun afterLast() { cursor = rows.size }
    override fun first(): Boolean { cursor = 0; return rows.isNotEmpty() }
    override fun last(): Boolean { cursor = rows.size - 1; return rows.isNotEmpty() }
    override fun getRow(): Int = cursor + 1
    override fun absolute(row: Int): Boolean { cursor = row - 1; return cursor < rows.size }
    override fun relative(rows: Int): Boolean { cursor += rows; return cursor < this.rows.size }
    override fun previous(): Boolean { cursor--; return cursor >= 0 }
    override fun setFetchDirection(d: Int) {}
    override fun getFetchDirection() = ResultSet.FETCH_FORWARD
    override fun setFetchSize(r: Int) {}
    override fun getFetchSize() = rows.size
    override fun getType() = ResultSet.TYPE_FORWARD_ONLY
    override fun getConcurrency() = ResultSet.CONCUR_READ_ONLY
    override fun rowUpdated() = false
    override fun rowInserted() = false
    override fun rowDeleted() = false
    override fun updateNull(idx: Int) {}
    override fun updateBoolean(idx: Int, x: Boolean) {}
    override fun updateByte(idx: Int, x: Byte) {}
    override fun updateShort(idx: Int, x: Short) {}
    override fun updateInt(idx: Int, x: Int) {}
    override fun updateLong(idx: Int, x: Long) {}
    override fun updateFloat(idx: Int, x: Float) {}
    override fun updateDouble(idx: Int, x: Double) {}
    override fun updateBigDecimal(idx: Int, x: java.math.BigDecimal?) {}
    override fun updateString(idx: Int, x: String?) {}
    override fun updateBytes(idx: Int, x: ByteArray?) {}
    override fun updateDate(idx: Int, x: java.sql.Date?) {}
    override fun updateTime(idx: Int, x: java.sql.Time?) {}
    override fun updateTimestamp(idx: Int, x: java.sql.Timestamp?) {}
    override fun updateAsciiStream(idx: Int, x: java.io.InputStream?, length: Int) {}
    override fun updateBinaryStream(idx: Int, x: java.io.InputStream?, length: Int) {}
    override fun updateCharacterStream(idx: Int, x: java.io.Reader?, length: Int) {}
    override fun updateObject(idx: Int, x: Any?, scaleOrLength: Int) {}
    override fun updateObject(idx: Int, x: Any?) {}
    override fun updateNull(label: String?) {}
    override fun updateBoolean(label: String?, x: Boolean) {}
    override fun updateByte(label: String?, x: Byte) {}
    override fun updateShort(label: String?, x: Short) {}
    override fun updateInt(label: String?, x: Int) {}
    override fun updateLong(label: String?, x: Long) {}
    override fun updateFloat(label: String?, x: Float) {}
    override fun updateDouble(label: String?, x: Double) {}
    override fun updateBigDecimal(label: String?, x: java.math.BigDecimal?) {}
    override fun updateString(label: String?, x: String?) {}
    override fun updateBytes(label: String?, x: ByteArray?) {}
    override fun updateDate(label: String?, x: java.sql.Date?) {}
    override fun updateTime(label: String?, x: java.sql.Time?) {}
    override fun updateTimestamp(label: String?, x: java.sql.Timestamp?) {}
    override fun updateAsciiStream(label: String?, x: java.io.InputStream?, length: Int) {}
    override fun updateBinaryStream(label: String?, x: java.io.InputStream?, length: Int) {}
    override fun updateCharacterStream(label: String?, x: java.io.Reader?, length: Int) {}
    override fun updateObject(label: String?, x: Any?, scaleOrLength: Int) {}
    override fun updateObject(label: String?, x: Any?) {}
    override fun insertRow() {}
    override fun updateRow() {}
    override fun deleteRow() {}
    override fun refreshRow() {}
    override fun cancelRowUpdates() {}
    override fun moveToInsertRow() {}
    override fun moveToCurrentRow() {}
    override fun getStatement(): java.sql.Statement? = null
    override fun getObject(idx: Int, map: MutableMap<String, Class<*>>?): Any? = getObject(idx)
    override fun getRef(idx: Int): java.sql.Ref? = null
    override fun getBlob(idx: Int): java.sql.Blob? = null
    override fun getClob(idx: Int): java.sql.Clob? = null
    override fun getArray(idx: Int): java.sql.Array? = null
    override fun getObject(label: String?, map: MutableMap<String, Class<*>>?): Any? = getObject(label)
    override fun getRef(label: String?): java.sql.Ref? = null
    override fun getBlob(label: String?): java.sql.Blob? = null
    override fun getClob(label: String?): java.sql.Clob? = null
    override fun getArray(label: String?): java.sql.Array? = null
    override fun getDate(idx: Int, cal: java.util.Calendar?): java.sql.Date? = null
    override fun getDate(label: String?, cal: java.util.Calendar?): java.sql.Date? = null
    override fun getTime(idx: Int, cal: java.util.Calendar?): java.sql.Time? = null
    override fun getTime(label: String?, cal: java.util.Calendar?): java.sql.Time? = null
    override fun getTimestamp(idx: Int, cal: java.util.Calendar?): java.sql.Timestamp? = null
    override fun getTimestamp(label: String?, cal: java.util.Calendar?): java.sql.Timestamp? = null
    override fun getURL(idx: Int): java.net.URL? = null
    override fun getURL(label: String?): java.net.URL? = null
    override fun updateRef(idx: Int, x: java.sql.Ref?) {}
    override fun updateRef(label: String?, x: java.sql.Ref?) {}
    override fun updateBlob(idx: Int, x: java.sql.Blob?) {}
    override fun updateBlob(label: String?, x: java.sql.Blob?) {}
    override fun updateClob(idx: Int, x: java.sql.Clob?) {}
    override fun updateClob(label: String?, x: java.sql.Clob?) {}
    override fun updateArray(idx: Int, x: java.sql.Array?) {}
    override fun updateArray(label: String?, x: java.sql.Array?) {}
    override fun getRowId(idx: Int): java.sql.RowId? = null
    override fun getRowId(label: String?): java.sql.RowId? = null
    override fun updateRowId(idx: Int, x: java.sql.RowId?) {}
    override fun updateRowId(label: String?, x: java.sql.RowId?) {}
    override fun getHoldability() = ResultSet.HOLD_CURSORS_OVER_COMMIT
    override fun getNClob(idx: Int): java.sql.NClob? = null
    override fun getNClob(label: String?): java.sql.NClob? = null
    override fun getSQLXML(idx: Int): java.sql.SQLXML? = null
    override fun getSQLXML(label: String?): java.sql.SQLXML? = null
    override fun updateSQLXML(idx: Int, x: java.sql.SQLXML?) {}
    override fun updateSQLXML(label: String?, x: java.sql.SQLXML?) {}
    override fun getNString(idx: Int): String? = null
    override fun getNString(label: String?): String? = null
    override fun getNCharacterStream(idx: Int): java.io.Reader? = null
    override fun getNCharacterStream(label: String?): java.io.Reader? = null
    override fun updateNCharacterStream(idx: Int, x: java.io.Reader?, length: Long) {}
    override fun updateNCharacterStream(label: String?, reader: java.io.Reader?, length: Long) {}
    override fun updateAsciiStream(idx: Int, x: java.io.InputStream?, length: Long) {}
    override fun updateBinaryStream(idx: Int, x: java.io.InputStream?, length: Long) {}
    override fun updateCharacterStream(idx: Int, x: java.io.Reader?, length: Long) {}
    override fun updateAsciiStream(label: String?, x: java.io.InputStream?, length: Long) {}
    override fun updateBinaryStream(label: String?, x: java.io.InputStream?, length: Long) {}
    override fun updateCharacterStream(label: String?, reader: java.io.Reader?, length: Long) {}
    override fun updateBlob(idx: Int, inputStream: java.io.InputStream?, length: Long) {}
    override fun updateBlob(label: String?, inputStream: java.io.InputStream?, length: Long) {}
    override fun updateClob(idx: Int, reader: java.io.Reader?, length: Long) {}
    override fun updateClob(label: String?, reader: java.io.Reader?, length: Long) {}
    override fun updateNClob(idx: Int, reader: java.io.Reader?, length: Long) {}
    override fun updateNClob(label: String?, reader: java.io.Reader?, length: Long) {}
    override fun updateNCharacterStream(idx: Int, x: java.io.Reader?) {}
    override fun updateNCharacterStream(label: String?, reader: java.io.Reader?) {}
    override fun updateAsciiStream(idx: Int, x: java.io.InputStream?) {}
    override fun updateBinaryStream(idx: Int, x: java.io.InputStream?) {}
    override fun updateCharacterStream(idx: Int, x: java.io.Reader?) {}
    override fun updateAsciiStream(label: String?, x: java.io.InputStream?) {}
    override fun updateBinaryStream(label: String?, x: java.io.InputStream?) {}
    override fun updateCharacterStream(label: String?, reader: java.io.Reader?) {}
    override fun updateBlob(idx: Int, inputStream: java.io.InputStream?) {}
    override fun updateBlob(label: String?, inputStream: java.io.InputStream?) {}
    override fun updateClob(idx: Int, reader: java.io.Reader?) {}
    override fun updateClob(label: String?, reader: java.io.Reader?) {}
    override fun updateNClob(idx: Int, reader: java.io.Reader?) {}
    override fun updateNClob(label: String?, reader: java.io.Reader?) {}
    override fun <T : Any?> getObject(idx: Int, type: Class<T>?): T? = null
    override fun <T : Any?> getObject(label: String?, type: Class<T>?): T? = null
    override fun findColumn(columnLabel: String?): Int = colNames.indexOf(columnLabel) + 1
    override fun updateNString(columnIndex: Int, nString: String?) {}
    override fun updateNString(columnLabel: String?, nString: String?) {}
    override fun updateNClob(columnIndex: Int, nClob: java.sql.NClob?) {}
    override fun updateNClob(columnLabel: String?, nClob: java.sql.NClob?) {}
    @Suppress("DEPRECATION")
    override fun getUnicodeStream(columnLabel: String?): java.io.InputStream? = null
    override fun getBinaryStream(columnLabel: String?): java.io.InputStream? = null
    override fun <T : Any?> unwrap(c: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(c: Class<*>?) = false
    override fun getBoolean(label: String?) = false
    override fun getByte(label: String?): Byte = 0
    override fun getShort(label: String?): Short = 0
    override fun getInt(label: String?): Int = (rows[cursor][label] as? Number)?.toInt() ?: 0
    override fun getLong(label: String?): Long = (rows[cursor][label] as? Number)?.toLong() ?: 0L
    override fun getFloat(label: String?) = 0f
    override fun getDouble(label: String?) = 0.0
    @Suppress("DEPRECATION")
    override fun getBigDecimal(label: String?, scale: Int): java.math.BigDecimal? = null
    override fun getBytes(label: String?): ByteArray? = null
    override fun getDate(label: String?): java.sql.Date? = null
    override fun getTime(label: String?): java.sql.Time? = null
    override fun getTimestamp(label: String?): java.sql.Timestamp? = null
    override fun getAsciiStream(label: String?): java.io.InputStream? = null
    override fun getCharacterStream(label: String?): java.io.Reader? = null
    override fun getBigDecimal(label: String?): java.math.BigDecimal? = null
}

private fun noopDs(): javax.sql.DataSource = object : javax.sql.DataSource {
    override fun getConnection(): java.sql.Connection = throw UnsupportedOperationException()
    override fun getConnection(u: String?, p: String?): java.sql.Connection = throw UnsupportedOperationException()
    override fun getLogWriter(): java.io.PrintWriter? = null
    override fun setLogWriter(out: java.io.PrintWriter?) {}
    override fun setLoginTimeout(s: Int) {}
    override fun getLoginTimeout() = 0
    override fun getParentLogger() = java.util.logging.Logger.getLogger("noop")
    override fun <T : Any?> unwrap(c: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(c: Class<*>?) = false
}

private fun noopSecretService() = com.vectorbea.worker.connector.SecretService(null, noopDs())

@Suppress("UNCHECKED_CAST")
private fun noopPubSub(): io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String> =
    java.lang.reflect.Proxy.newProxyInstance(
        Thread.currentThread().contextClassLoader,
        arrayOf(io.lettuce.core.pubsub.StatefulRedisPubSubConnection::class.java),
    ) { _, _, _ -> null } as io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String>
