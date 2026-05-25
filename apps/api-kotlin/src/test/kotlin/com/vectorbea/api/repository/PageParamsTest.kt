package com.vectorbea.api.repository

import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.CsvSource
import kotlin.test.assertEquals

class PageParamsTest {

    @Test
    fun `default params are page 1 size 20`() {
        val params = PageParams()
        assertEquals(1, params.page)
        assertEquals(20, params.pageSize)
    }

    @Test
    fun `offset is zero for first page`() {
        val params = PageParams(page = 1, pageSize = 20)
        assertEquals(0, params.offset)
    }

    @Test
    fun `offset is pageSize for second page`() {
        val params = PageParams(page = 2, pageSize = 20)
        assertEquals(20, params.offset)
    }

    @Test
    fun `offset calculation with custom page size`() {
        val params = PageParams(page = 3, pageSize = 50)
        assertEquals(100, params.offset)
    }

    @Test
    fun `limit equals pageSize`() {
        val params = PageParams(page = 1, pageSize = 25)
        assertEquals(25, params.limit)
    }

    @Test
    fun `from with valid strings`() {
        val params = PageParams.from("3", "50")
        assertEquals(3, params.page)
        assertEquals(50, params.pageSize)
    }

    @Test
    fun `from with null strings uses defaults`() {
        val params = PageParams.from(null, null)
        assertEquals(1, params.page)
        assertEquals(20, params.pageSize)
    }

    @Test
    fun `from with invalid page string defaults to 1`() {
        val params = PageParams.from("abc", "20")
        assertEquals(1, params.page)
    }

    @Test
    fun `from clamps page to minimum 1`() {
        val params = PageParams.from("0", "20")
        assertEquals(1, params.page)
    }

    @Test
    fun `from clamps negative page to 1`() {
        val params = PageParams.from("-5", "20")
        assertEquals(1, params.page)
    }

    @Test
    fun `from clamps pageSize to maximum 100`() {
        val params = PageParams.from("1", "500")
        assertEquals(100, params.pageSize)
    }

    @Test
    fun `from clamps pageSize to minimum 1`() {
        val params = PageParams.from("1", "0")
        assertEquals(1, params.pageSize)
    }

    @Test
    fun `from with invalid pageSize string defaults to 20`() {
        val params = PageParams.from("1", "xyz")
        assertEquals(20, params.pageSize)
    }

    @ParameterizedTest
    @CsvSource("1,20,0", "2,20,20", "3,10,20", "5,50,200")
    fun `offset computed correctly for various pages and sizes`(page: Int, size: Int, expectedOffset: Int) {
        val params = PageParams(page = page, pageSize = size)
        assertEquals(expectedOffset, params.offset)
    }

    @Test
    fun `Page data class holds correct values`() {
        val items = listOf("a", "b", "c")
        val page = Page(items = items, total = 100L, page = 2, pageSize = 3)
        assertEquals(items, page.items)
        assertEquals(100L, page.total)
        assertEquals(2, page.page)
        assertEquals(3, page.pageSize)
    }
}
