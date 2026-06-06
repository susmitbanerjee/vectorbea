package com.vectorbea.telemetry.db

import org.flywaydb.core.Flyway
import org.slf4j.LoggerFactory
import javax.sql.DataSource

object Migrations {
    private val log = LoggerFactory.getLogger(Migrations::class.java)

    fun run(ds: DataSource) {
        log.info("[migrations] running Flyway migrations")
        flyway(ds).migrate()
        log.info("[migrations] Flyway migrations complete")
    }

    fun validate(ds: DataSource) {
        flyway(ds).validate()
    }

    private fun flyway(ds: DataSource): Flyway = Flyway.configure()
        .dataSource(ds)
        .locations("classpath:db/migration")
        .baselineOnMigrate(true)
        .repairOnMigrate(true)
        .load()
}
