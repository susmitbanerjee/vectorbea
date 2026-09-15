package com.vectorbea.api.config

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

/**
 * The host we hand out — in webhook URLs and OAuth redirect URIs — follows the
 * environment and is never the platform provider's.
 */
class PublicUrlsTest {

    private fun env(vararg pairs: Pair<String, String>): (String) -> String? = pairs.toMap()::get

    @Test
    fun `production hands out api dot vectorbea`() {
        assertEquals("https://api.vectorbea.com", PublicUrls.apiBase(env("VECTORBEA_ENV" to "prod", "APP_ENV" to "production")))
    }

    @Test
    fun `every non-production environment hands out devapi`() {
        for (name in listOf("dev", "stage", "staging")) {
            assertEquals("https://devapi.vectorbea.com", PublicUrls.apiBase(env("VECTORBEA_ENV" to name, "APP_ENV" to "production")))
        }
    }

    @Test
    fun `a hosted deployment that forgot VECTORBEA_ENV still never prints localhost`() {
        assertEquals("https://api.vectorbea.com",
            PublicUrls.apiBase(env("APP_ENV" to "production", "RAILWAY_ENVIRONMENT_NAME" to "production")))
        assertEquals("https://devapi.vectorbea.com",
            PublicUrls.apiBase(env("APP_ENV" to "production", "RAILWAY_ENVIRONMENT_NAME" to "staging")))
        assertFalse(PublicUrls.apiBase(env("APP_ENV" to "production")).contains("localhost"))
    }

    @Test
    fun `an explicit public base wins`() {
        assertEquals("https://api.customer.example",
            PublicUrls.apiBase(env("PUBLIC_API_BASE_URL" to "https://api.customer.example/", "VECTORBEA_ENV" to "prod")))
    }

    @Test
    fun `local development uses the local port`() {
        assertEquals("http://localhost:9090", PublicUrls.apiBase(env("PORT" to "9090")))
    }

    @Test
    fun `the app origin only ever comes from a host we own`() {
        assertEquals("https://dev.vectorbea.com",
            PublicUrls.appBase(env("APP_URL" to "https://evil.example", "VECTORBEA_ENV" to "dev", "APP_ENV" to "production")))
        assertEquals("https://app.vectorbea.com", PublicUrls.appBase(env("APP_URL" to "https://app.vectorbea.com/")))
    }
}
