package com.vectorbea.api.repository

/**
 * Pagination container returned by all list endpoints.
 *
 * @param items   The items on this page.
 * @param total   Total number of matching items across all pages.
 * @param page    Current 1-based page number.
 * @param pageSize Number of items per page requested.
 */
data class Page<T>(
    val items: List<T>,
    val total: Long,
    val page: Int,
    val pageSize: Int,
) {
    val totalPages: Int get() = if (pageSize == 0) 0 else ((total + pageSize - 1) / pageSize).toInt()
    val hasNext: Boolean get() = page < totalPages
    val hasPrev: Boolean get() = page > 1

    companion object {
        fun <T> empty(page: Int = 1, pageSize: Int = 20) = Page<T>(
            items = emptyList(), total = 0L, page = page, pageSize = pageSize
        )
    }
}

/**
 * Pagination parameters parsed from query string.
 * page is 1-based; defaults to page=1, pageSize=20, max pageSize=100.
 */
data class PageParams(val page: Int = 1, val pageSize: Int = 20) {
    val offset: Int get() = (page - 1) * pageSize
    val limit: Int get() = pageSize

    companion object {
        fun from(pageStr: String?, pageSizeStr: String?): PageParams {
            val page = pageStr?.toIntOrNull()?.coerceAtLeast(1) ?: 1
            val size = pageSizeStr?.toIntOrNull()?.coerceIn(1, 100) ?: 20
            return PageParams(page, size)
        }
    }
}
