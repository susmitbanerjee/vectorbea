package com.vectorbea.sdk

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class PromptTest {

    private fun makePrompt(template: String) = Prompt(
        promptId         = "00000000-0000-0000-0000-000000000001",
        promptVersionId  = "00000000-0000-0000-0000-000000000002",
        organizationId   = "00000000-0000-0000-0000-000000000003",
        name             = "test-prompt",
        versionTag       = "v1.0.0",
        templateText     = template,
    )

    // ── compile() ─────────────────────────────────────────────────────────────

    @Test
    fun `compile substitutes single variable`() {
        val prompt = makePrompt("Hello {{name}}!")
        assertEquals("Hello Alice!", prompt.compile(mapOf("name" to "Alice")))
    }

    @Test
    fun `compile substitutes multiple variables`() {
        val prompt = makePrompt("Hello {{name}}, welcome to {{product}}!")
        val result = prompt.compile(mapOf("name" to "Bob", "product" to "VectorBea"))
        assertEquals("Hello Bob, welcome to VectorBea!", result)
    }

    @Test
    fun `compile handles whitespace inside braces`() {
        val prompt = makePrompt("Hi {{ name }} from {{ product }}.")
        val result = prompt.compile(mapOf("name" to "Carol", "product" to "Acme"))
        assertEquals("Hi Carol from Acme.", result)
    }

    @Test
    fun `compile with no variables on template with no placeholders`() {
        val prompt = makePrompt("No variables here.")
        assertEquals("No variables here.", prompt.compile(emptyMap()))
    }

    @Test
    fun `compile with extra variables ignores the extras`() {
        val prompt = makePrompt("Hello {{name}}!")
        // Extra keys are silently ignored — not an error
        assertEquals("Hello Dave!", prompt.compile(mapOf("name" to "Dave", "unused" to "x")))
    }

    @Test
    fun `compile throws on missing variable`() {
        val prompt = makePrompt("Hello {{name}} from {{product}}!")
        val ex = assertFailsWith<IllegalArgumentException> {
            prompt.compile(mapOf("name" to "Eve")) // "product" missing
        }
        assert(ex.message!!.contains("product")) {
            "Expected error message to mention the missing variable"
        }
    }

    @Test
    fun `compile throws listing all missing variables`() {
        val prompt = makePrompt("{{a}} {{b}} {{c}}")
        val ex = assertFailsWith<IllegalArgumentException> {
            prompt.compile(emptyMap())
        }
        val msg = ex.message!!
        assert("a" in msg && "b" in msg && "c" in msg) {
            "Expected all three missing keys in error message, got: $msg"
        }
    }
}
