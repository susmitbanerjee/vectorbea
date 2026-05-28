package com.vectorbea.worker.logging

import org.slf4j.Logger
import org.slf4j.LoggerFactory

/**
 * Thin SLF4J wrapper.
 *
 * Usage:
 *   private val log = logger()         // in any class
 *   private val log = logger("name")   // top-level functions
 *
 * SECURITY: never pass secrets, connection strings, or API keys as log
 * message arguments. Use [com.vectorbea.worker.security.Redactor] first.
 */
inline fun <reified T : Any> T.logger(): Logger =
    LoggerFactory.getLogger(T::class.java)

fun logger(name: String): Logger = LoggerFactory.getLogger(name)
