package com.vectorbea.api.repository

import com.vectorbea.api.db.Database
import com.vectorbea.api.model.OrganizationView
import java.sql.Connection
import java.time.OffsetDateTime
import java.util.UUID

class OrganizationRepository(private val database: Database) {
    fun list(organizationId: UUID): List<OrganizationView> =
        database.query { connection ->
            connection.prepareStatement(
                """
                select id, name, created_at, plan_tier, stripe_customer_id, stripe_subscription_id, max_seats
                from public.organizations
                where id = ?
                order by created_at asc, name asc
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            add(mapOrganization(rs))
                        }
                    }
                }
            }
        }

    fun countOwnedOrganizations(userId: UUID, planTier: String = "free"): Int =
        database.query { connection ->
            connection.prepareStatement(
                """
                select count(*)
                from public.org_members om
                join public.organizations o on o.id = om.organization_id
                where om.user_id = ?
                  and om.role = 'owner'
                  and o.plan_tier = ?::public.plan_tier
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, userId)
                statement.setString(2, planTier)
                statement.executeQuery().use { rs ->
                    rs.next()
                    rs.getInt(1)
                }
            }
        }

    fun createForOwner(name: String, ownerUserId: UUID): OrganizationView =
        database.transaction { connection ->
            val organization = connection.prepareStatement(
                """
                insert into public.organizations (name)
                values (?)
                returning id, name, created_at, plan_tier, stripe_customer_id, stripe_subscription_id, max_seats
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, name)
                statement.executeQuery().use { rs ->
                    rs.next()
                    mapOrganization(rs)
                }
            }

            connection.prepareStatement(
                """
                insert into public.org_members (user_id, organization_id, role)
                values (?, ?, 'owner'::public.org_role)
                on conflict (user_id, organization_id) do update
                set role = excluded.role
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, ownerUserId)
                statement.setObject(2, organization.id)
                statement.executeUpdate()
            }

            val workspaceId = connection.prepareStatement(
                """
                insert into public.workspaces (organization_id, name)
                values (?, 'default')
                returning id
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organization.id)
                statement.executeQuery().use { rs ->
                    rs.next()
                    rs.getObject("id", UUID::class.java)
                }
            }

            connection.prepareStatement(
                """
                insert into public.workspace_members (user_id, workspace_id, role)
                values (?, ?, 'admin'::public.workspace_role)
                on conflict (user_id, workspace_id) do update
                set role = excluded.role
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, ownerUserId)
                statement.setObject(2, workspaceId)
                statement.executeUpdate()
            }

            organization
        }

    private fun mapOrganization(rs: java.sql.ResultSet) = OrganizationView(
        id = rs.getObject("id", UUID::class.java),
        name = rs.getString("name"),
        createdAt = rs.getObject("created_at", OffsetDateTime::class.java),
        planTier = rs.getString("plan_tier"),
        stripeCustomerId = rs.getString("stripe_customer_id"),
        stripeSubscriptionId = rs.getString("stripe_subscription_id"),
        maxSeats = rs.getInt("max_seats"),
    )
}
