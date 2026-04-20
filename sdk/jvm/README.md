# vectorbea-jvm-sdk

Official Kotlin/JVM SDK for the [VectorBea](https://vectorbea.com) prompt management platform.

## Requirements

- Java 17+
- Kotlin 1.9+ (or any JVM language)

---

## Installation

### Gradle (Kotlin DSL)

```kotlin
dependencies {
    implementation("com.vectorbea:vectorbea-jvm-sdk:0.2.1")
}
```

### Gradle (Groovy DSL)

```groovy
dependencies {
    implementation 'com.vectorbea:vectorbea-jvm-sdk:0.2.1'
}
```

### Maven

```xml
<dependency>
    <groupId>com.vectorbea</groupId>
    <artifactId>vectorbea-jvm-sdk</artifactId>
    <version>0.2.1</version>
</dependency>
```

---

## Quick start

```kotlin
import com.vectorbea.sdk.VectorBeaClient

// API key is read from VECTORBEA_API_KEY env var if .apiKey() is not called.
// baseUrl defaults to http://localhost:8080 (local sidecar).
val client = VectorBeaClient.Builder()
    .apiKey("vbagent_your_token_here")   // replace with your key
    .baseUrl("http://localhost:8080")    // omit for default
    .build()

// Fetch a prompt and compile it with runtime variables
val prompt  = client.getPrompt("greet-user")
val message = prompt.compile(mapOf("name" to "Alice", "product" to "Acme AI"))
println(message) // "Hello Alice, welcome to Acme AI!"

client.close() // release connection pool on shutdown
```

### Using with a coroutine scope

`getPrompt` and `logAudit` are `suspend` functions — call them from any
coroutine context. The SDK dispatches the blocking OkHttp call onto
`Dispatchers.IO` automatically, so your calling scope is never blocked.

```kotlin
import kotlinx.coroutines.runBlocking

fun main() = runBlocking {
    val client = VectorBeaClient.Builder()
        .apiKey(System.getenv("VECTORBEA_API_KEY"))
        .build()

    val prompt  = client.getPrompt("customer-support-reply")
    val message = prompt.compile(mapOf(
        "customer_name" to "Bob",
        "issue"         to "billing",
    ))
    println(message)

    client.close()
}
```

### With `use` (auto-close)

`VectorBeaClient` implements `Closeable`, so you can scope it with `use`:

```kotlin
VectorBeaClient.Builder().apiKey("vbagent_your_token_here").build().use { client ->
    val prompt  = client.getPrompt("greet-user")
    val message = prompt.compile(mapOf("name" to "Alice"))
    println(message)
}
```

---

## Targeting the cloud instead of the local sidecar

The default `baseUrl` is `http://localhost:8080` (the local VectorBea sidecar).
Override it to point at VectorBea Cloud or a custom host:

```kotlin
val client = VectorBeaClient.Builder()
    .apiKey(System.getenv("VECTORBEA_API_KEY"))
    .baseUrl("https://app.vectorbea.com")
    .build()
```

Or use the `VECTORBEA_BASE_URL` environment variable — the SDK reads it
automatically if `.baseUrl()` is not called.

---

## Audit telemetry

`getPrompt()` automatically records proxy fetch latency. Call `logAudit()`
after your LLM responds to add LLM latency and token counts:

```kotlin
val prompt = client.getPrompt("greet-user")
// ... call your LLM ...

client.logAudit(
    prompt       = prompt,
    llmLatencyMs = 432L,
    tokenCount   = 87,
    metadata     = mapOf("model" to "gpt-4o"),
)
```

Audit failures are swallowed internally — they are logged to `stderr` but
never propagate as exceptions, so they cannot break your application.

---

## Exception hierarchy

All SDK exceptions extend `VectorBeaException`. Catch specific subtypes for
fine-grained handling:

```
VectorBeaException
├── APIException               — non-2xx HTTP response (has .statusCode)
│   ├── AuthenticationException  — 401 Unauthorized
│   └── NotFoundException        — 404 Not Found
├── ConnectionException        — network-level failure (proxy not reachable)
└── TimeoutException           — request exceeded the configured timeout
```

```kotlin
import com.vectorbea.sdk.*

try {
    val prompt = client.getPrompt("my-prompt")
} catch (e: AuthenticationException) {
    println("Invalid API key — regenerate from the VectorBea dashboard")
} catch (e: NotFoundException) {
    println("Prompt not found or has no published version")
} catch (e: TimeoutException) {
    println("Request timed out — increase via .timeoutSeconds()")
} catch (e: ConnectionException) {
    println("Could not reach the VectorBea proxy — is the container running?")
} catch (e: VectorBeaException) {
    println("Unexpected SDK error: ${e.message}")
}
```

---

## Configuration reference

| Builder method        | Environment variable     | Default                      | Description                         |
|-----------------------|--------------------------|------------------------------|-------------------------------------|
| `.apiKey(key)`        | `VECTORBEA_API_KEY`      | *(required)*                 | Workspace API key (`vbagent_...`)   |
| `.baseUrl(url)`       | `VECTORBEA_BASE_URL`     | `http://localhost:8080`      | Proxy or hub base URL               |
| `.timeoutSeconds(n)`  | —                        | `10`                         | Connect / read / write timeout (s)  |

---

## License

MIT — see [LICENSE](./LICENSE).
