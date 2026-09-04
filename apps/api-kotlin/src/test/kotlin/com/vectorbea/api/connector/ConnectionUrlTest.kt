package com.vectorbea.api.connector

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Connection strings as people actually hold them.
 *
 * Every case below was measured against the previous `java.net.URI` parser
 * first: seven of them threw or lost the host, and the two that survived were
 * the only two anybody had thought to test. That is why a Supabase password
 * with a `#` in it came back as "Database authentication failed — check
 * credentials" against credentials the user could see were correct.
 *
 * Passwords here are deliberately hostile. They are what a password generator
 * produces and what the Supabase dashboard shows without encoding.
 */
class ConnectionUrlTest {

    private val poolerHost = "aws-0-ap-south-1.pooler.supabase.com"

    private fun target(url: String) = DbTester.resolvePostgresTarget(
        DbTester.DbTestInput(
            dbType = "postgresql",
            connectionUrl = url,
            password = null,
            username = null,
            host = null,
            port = null,
            database = null,
        ),
    )

    // ── The Supabase shapes ──────────────────────────────────────────────────

    @Test
    fun `session pooler url keeps the dotted username`() {
        val t = target("postgresql://postgres.abcdefg:MyPassw0rd@$poolerHost:5432/postgres")
        assertEquals("jdbc:postgresql://$poolerHost:5432/postgres", t.jdbcUrl)
        assertEquals("postgres.abcdefg", t.username)
        assertEquals("MyPassw0rd", t.password)
    }

    @Test
    fun `transaction pooler url keeps its query string`() {
        val t = target("postgresql://postgres.abcdefg:MyPassw0rd@$poolerHost:6543/postgres?pgbouncer=true")
        assertEquals("jdbc:postgresql://$poolerHost:6543/postgres?pgbouncer=true", t.jdbcUrl)
        assertEquals("postgres.abcdefg", t.username)
    }

    @Test
    fun `direct supabase url parses`() {
        val t = target("postgresql://postgres:MyPassw0rd@db.abcdefg.supabase.co:5432/postgres")
        assertEquals("jdbc:postgresql://db.abcdefg.supabase.co:5432/postgres", t.jdbcUrl)
        assertEquals("postgres", t.username)
    }

    // ── Passwords that used to break it ──────────────────────────────────────

    @Test
    fun `unencoded reserved characters in the password survive`() {
        // `#` started a fragment, `?` a query, `/` ended the authority, `@`
        // confused the userinfo split. All four produced a null host, reported
        // as "URL must include a host" about a URL that has one.
        for (password in listOf("pa#ss", "pa?ss", "pa/ss", "pa@ss", "pa[ss]", "pa ss", "pa%ss", "p:ass")) {
            val t = target("postgresql://postgres.abc:$password@$poolerHost:5432/postgres")
            assertEquals(password, t.password, "password `$password` must survive parsing")
            assertEquals("postgres.abc", t.username, "username must survive password `$password`")
            assertEquals("jdbc:postgresql://$poolerHost:5432/postgres", t.jdbcUrl)
        }
    }

    @Test
    fun `a percent-encoded password is decoded`() {
        val t = target("postgresql://app%40tenant:p%2Bass@db.example.com:5433/wf?sslmode=require")
        assertEquals("app@tenant", t.username)
        assertEquals("p+ass", t.password)
    }

    @Test
    fun `a literal password that cannot be encoded output is left alone`() {
        // Contains `/`, so it cannot be the output of percent-encoding, so the
        // `%2F` inside it is literal text rather than an escape.
        val t = target("postgresql://u:a%2Fb/c@db.example.com:5432/postgres")
        assertEquals("a%2Fb/c", t.password)
    }

    // ── Copy-paste debris ────────────────────────────────────────────────────

    @Test
    fun `surrounding whitespace and a trailing newline are tolerated`() {
        for (raw in listOf(
            "  postgresql://postgres.abc:pass@$poolerHost:5432/postgres  ",
            "postgresql://postgres.abc:pass@$poolerHost:5432/postgres\n",
            "\tpostgresql://postgres.abc:pass@$poolerHost:5432/postgres\r\n",
        )) {
            val t = target(raw)
            assertEquals("jdbc:postgresql://$poolerHost:5432/postgres", t.jdbcUrl)
            assertEquals("postgres.abc", t.username)
            assertEquals("pass", t.password)
        }
    }

    // ── Empty form fields must not win over the URL ──────────────────────────

    @Test
    fun `a blank username field does not override the url credentials`() {
        // This is its own AUTH_FAILED: an empty user meant the property was
        // never set, so the driver fell back to the OS account.
        val t = DbTester.resolvePostgresTarget(
            DbTester.DbTestInput(
                dbType = "postgresql",
                connectionUrl = "postgresql://postgres.abc:pass@$poolerHost:5432/postgres",
                password = "",
                username = "",
                host = null,
                port = null,
                database = null,
            ),
        )
        assertEquals("postgres.abc", t.username)
        assertEquals("pass", t.password)
    }

    // ── Host extraction, which guidance depends on ───────────────────────────

    @Test
    fun `the host is recoverable even from a url with a hostile password`() {
        val host = DbTester.hostOf(
            DbTester.DbTestInput(
                dbType = "postgresql",
                connectionUrl = "postgresql://postgres.abc:pa#ss@db.abcdefg.supabase.co:5432/postgres",
                password = null, username = null, host = null, port = null, database = null,
            ),
        )
        assertEquals("db.abcdefg.supabase.co", host)
    }

    @Test
    fun `a url with no credentials still yields a host`() {
        val t = target("postgresql://$poolerHost:5432/postgres")
        assertEquals("jdbc:postgresql://$poolerHost:5432/postgres", t.jdbcUrl)
        assertNull(t.username)
        assertNull(t.password)
    }

    // ── The guidance attached to a genuine auth failure ──────────────────────

    @Test
    fun `pooler host with an undotted username is named as the likely cause`() {
        val guidance = DbTester.credentialGuidance(
            "AUTH_FAILED",
            DbTester.DbTestInput(
                dbType = "postgresql",
                connectionUrl = "postgresql://postgres:pass@$poolerHost:5432/postgres",
                password = null, username = null, host = null, port = null, database = null,
            ),
        )
        assertEquals(true, guidance?.contains("postgres.<project-ref>"), guidance)
    }

    @Test
    fun `guidance is silent when the failure is not an auth failure`() {
        assertNull(
            DbTester.credentialGuidance(
                "TIMEOUT",
                DbTester.DbTestInput(
                    dbType = "postgresql",
                    connectionUrl = "postgresql://postgres:pass@$poolerHost:5432/postgres",
                    password = null, username = null, host = null, port = null, database = null,
                ),
            ),
        )
    }

    // -- The ambiguous password, and how it is resolved ----------------------

    @Test
    fun `an ambiguous password carries its second reading`() {
        // `pa%2Fss` is either an escape for `pa/ss` or six literal characters.
        // Both must reach the driver, because the string cannot say which.
        val t = target("postgresql://postgres.abc:pa%2Fss@$poolerHost:5432/postgres")
        assertEquals("pa/ss", t.password, "the decoded reading is tried first")
        assertEquals("pa%2Fss", t.alternatePassword, "the literal reading must survive as a fallback")
    }

    @Test
    fun `an unambiguous password has no second reading to try`() {
        // Nothing that looks like an escape, so there is only one reading and
        // the ordinary connection must make exactly one login attempt.
        assertNull(target("postgresql://postgres.abc:MyPassw0rd@$poolerHost:5432/postgres").alternatePassword)
        // Contains `/`, so it cannot be encoder output - also unambiguous.
        assertNull(target("postgresql://postgres.abc:pa/ss@$poolerHost:5432/postgres").alternatePassword)
    }

    @Test
    fun `a password typed into the form field is never retried`() {
        // A form field is not a URL component, so nothing was decoded and there
        // is no second reading. Retrying here would be a bare second login
        // attempt with the same password.
        val t = DbTester.resolvePostgresTarget(
            DbTester.DbTestInput(
                dbType = "postgresql",
                connectionUrl = "postgresql://postgres.abc:pa%2Fss@$poolerHost:5432/postgres",
                password = "pa%2Fss",
                username = null, host = null, port = null, database = null,
            ),
        )
        assertEquals("pa%2Fss", t.password)
        assertNull(t.alternatePassword)
    }

    @Test
    fun `guidance for an ambiguous password says both readings were tried`() {
        val guidance = DbTester.credentialGuidance(
            "AUTH_FAILED",
            DbTester.DbTestInput(
                dbType = "postgresql",
                connectionUrl = "postgresql://postgres.abc:pa%2Fss@$poolerHost:5432/postgres",
                password = null, username = null, host = null, port = null, database = null,
            ),
        )
        // It must not claim the password "was read literally" - by the time this
        // runs, both readings have been rejected by the server.
        assertEquals(true, guidance?.contains("Both readings"), guidance)
    }

    @Test
    fun `guidance for a reserved-character password does not promise a retry`() {
        val guidance = DbTester.credentialGuidance(
            "AUTH_FAILED",
            DbTester.DbTestInput(
                dbType = "postgresql",
                connectionUrl = "postgresql://postgres.abc:pa#ss@$poolerHost:5432/postgres",
                password = null, username = null, host = null, port = null, database = null,
            ),
        )
        assertEquals(true, guidance?.contains("read literally"), guidance)
    }

    @Test
    fun `mysql urls get the same second reading`() {
        val t = DbTester.resolveMysqlTarget(
            DbTester.DbTestInput(
                dbType = "mysql",
                connectionUrl = "mysql://root:pa%2Fss@db.example.com:3306/app",
                password = null, username = null, host = null, port = null, database = null,
            ),
        )
        assertEquals("jdbc:mysql://db.example.com:3306/app", t.jdbcUrl)
        assertEquals("pa/ss", t.password)
        assertEquals("pa%2Fss", t.alternatePassword)
    }
}
