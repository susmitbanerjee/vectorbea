package com.vectorbea.api.http

class HttpException(
    val statusCode: Int,
    override val message: String
) : RuntimeException(message)
