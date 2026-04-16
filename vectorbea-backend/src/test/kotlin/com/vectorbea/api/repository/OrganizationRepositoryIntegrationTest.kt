package com.vectorbea.api.repository

import com.vectorbea.api.db.Database
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.sql.DriverManager
import java.util.UUID

@Testcontainers
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OrganizationRepositoryIntegrationTest {

    companion object {
        @Container
        @JvmStatic
        val postgres: PostgreSQLContainer<*> = PostgreSQLContainer("postgres:16")
            .withDatabaseName("vectorbea_test")
            .withUsername("test")
            .withPassword("test")
    }

    private lateinit var database: Database

    @BeforeAll
    fun setUp() {
        // Create a Database subclass that uses the Testcontainer connection
        database = object : Database() {
            override fun getConnection() = DriverManager.getConnection(
                postgres.jdbcUrl,
                postgres.username,
                postgres.password
            )
        }

        database.query { conn ->
            conn.createStatement().use { stmt ->
                stmt.execute(
                    """
                    CREATE SCHEMA IF NOT EXISTS vectorbea;

                    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

                    CREATE TABLE IF NOT EXISTS vectorbea.organizations (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        name TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        plan_tier TEXT NOT NULL DEFAULT 'free',
                        stripe_customer_id TEXT,
                        stripe_subscription_id TEXT,
                        max_seats INT NOT NULL DEFAULT 5
                    );

                    CREATE TABLE IF NOT EXISTS vectorbea.org_members (
                        user_id UUID NOT NULL,
                        organization_id UUID NOT NULL REFERENCES vectorbea.organizations(id) ON DELETE CASCADE,
                        role TEXT NOT NULL DEFAULT 'member',
                        PRIMARY KEY (user_id, organization_id)
                    );

                    CREATE TABLE IF NOT EXISTS vectorbea.workspaces (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        organization_id UUID NOT NULL REFERENCES vectorbea.organizations(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    );

                    CREATE TABLE IF NOT EXISTS vectorbea.workspace_members (
                        user_id UUID NOT NULL,
                        workspace_id UUID NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
                        role TEXT NOT NULL DEFAULT 'viewer',
                        granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                        PRIMARY KEY (user_id, workspace_id)
                    );
                    """.trimIndent()
                )
            }
        }
    }

    private fun insertOrg(name: String): UUID =
        database.query { conn ->
            conn.prepareStatement(
                "INSERT INTO vectorbea.organizations (name) VALUES (?) RETURNING id"
            ).use { stmt ->
                stmt.setString(1, name)
                stmt.executeQuery().use { rs ->
                    rs.next()
                    rs.getObject("id", UUID::class.java)
                }
            }
        }

    private fun insertWorkspace(orgId: UUID, name: String): UUID =
        database.query { conn ->
            conn.prepareStatement(
                "INSERT INTO vectorbea.workspaces (organization_id, name) VALUES (?, ?) RETURNING id"
            ).use { stmt ->
                stmt.setObject(1, orgId)
                stmt.setString(2, name)
                stmt.executeQuery().use { rs ->
                    rs.next()
                    rs.getObject("id", UUID::class.java)
                }
            }
        }

    private fun listWorkspacesForOrg(orgId: UUID): List<UUID> =
        database.query { conn ->
            conn.prepareStatement(
                "SELECT id FROM vectorbea.workspaces WHERE organization_id = ?"
            ).use { stmt ->
                stmt.setObject(1, orgId)
                stmt.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(rs.getObject("id", UUID::class.java))
                    }
                }
            }
        }

    @Test
    fun `workspaces for org A do not include workspaces from org B`() {
        val orgAId = insertOrg("Org Alpha")
        val orgBId = insertOrg("Org Beta")

        val wsA1 = insertWorkspace(orgAId, "alpha-workspace-1")
        val wsA2 = insertWorkspace(orgAId, "alpha-workspace-2")
        val wsB1 = insertWorkspace(orgBId, "beta-workspace-1")

        val orgAWorkspaces = listWorkspacesForOrg(orgAId)
        val orgBWorkspaces = listWorkspacesForOrg(orgBId)

        assertEquals(2, orgAWorkspaces.size, "Org A should have exactly 2 workspaces")
        assertTrue(orgAWorkspaces.containsAll(listOf(wsA1, wsA2)), "Org A workspaces should contain both alpha workspaces")
        assertTrue(!orgAWorkspaces.contains(wsB1), "Org A workspaces must not contain Org B's workspace")

        assertEquals(1, orgBWorkspaces.size, "Org B should have exactly 1 workspace")
        assertTrue(orgBWorkspaces.contains(wsB1), "Org B workspaces should contain beta-workspace-1")
        assertTrue(!orgBWorkspaces.containsAll(listOf(wsA1, wsA2)), "Org B workspaces must not contain Org A's workspaces")
    }

    @Test
    fun `inserting workspace for one org does not affect workspace count of another org`() {
        val orgCId = insertOrg("Org Gamma")
        val orgDId = insertOrg("Org Delta")

        insertWorkspace(orgCId, "gamma-ws")
        val countBefore = listWorkspacesForOrg(orgDId).size

        insertWorkspace(orgCId, "gamma-ws-2")
        val countAfter = listWorkspacesForOrg(orgDId).size

        assertEquals(countBefore, countAfter, "Adding a workspace to Org C must not change Org D's workspace count")
    }
}
