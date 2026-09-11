// mcp-kotlin — the MCP wire protocol, its sanitizer, and discovery.
//
// ── WHY THIS IS A MODULE AND NOT A COPY ─────────────────────────────────────
// Discovery is now called from BOTH services and the two must agree exactly.
//
//   · The API calls it when an operator presses Discover, and when the connect
//     wizard verifies a server — which is where the product says the sentence
//     "this server advertises 12 tools, here they are".
//   · The worker calls it whenever an agent's tool list is built.
//
// If the wizard's sentence were produced by a second implementation, it would
// be a claim about code that will not run the customer's tools — and the first
// time the two disagreed, the number on the screen is the one the customer
// would trust. Same lesson as `RunIngress` (invariant 16), where a sequence
// living in a route handler was reimplemented from memory by the scheduler and
// scheduled runs skipped every plan check in the product.
//
// Extracted rather than duplicated, following `skills-kotlin` and
// `graph-kotlin`: a real Gradle dependency through `includeBuild`.
//
// ── WHAT DELIBERATELY DOES NOT LIVE HERE ────────────────────────────────────
// `McpToolExecutor` stays in the worker. It is EXECUTION — node results, error
// observations, the circuit breaker, the approval gate's surroundings — and the
// API has no business holding any of it.
//
// ── AND WHY THE HTTP CLIENT IS AN INTERFACE ─────────────────────────────────
// The two services reach the network on different terms. The worker's egress
// goes through `OutboundHttp`: its clamped total-call ceiling, its streaming
// byte cap, its connection pool. The API's goes through its own SSRF guard and
// a plain JDK client. Both are correct for their side and neither belongs to
// the other, so [McpTransport] names the one thing the protocol needs — send
// this request, bounded — and each service supplies its own.
plugins {
    kotlin("jvm") version "2.1.20"
    `java-library`
}

group = "com.vectorbea"
version = "0.1.0"

repositories { mavenCentral() }

dependencies {
    api("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.2")
    // Discovery reads and writes the manifest cache through a caller-supplied
    // DataSource. javax.sql is in the JDK; nothing here binds a pool.
    api("org.slf4j:slf4j-api:2.0.13")
    testImplementation(kotlin("test"))
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// `McpDiscoveryTest`, `McpSanitizerTest` and `McpToolPathTest` stay in the
// worker. They assert this code against a real Postgres and a real
// `ToolNodeExecutor` — the grant model and the tool path — and moving them here
// would mean vendoring that test infrastructure to prove the same things less
// well. What is tested here is what needs no infrastructure: the protocol
// itself.

kotlin { jvmToolchain(17) }
tasks.test { useJUnitPlatform() }
