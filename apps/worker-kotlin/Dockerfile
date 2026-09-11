# =============================================================================
# vectorbea-worker — Kotlin workflow worker
# Multi-stage build: Gradle fat-jar → JRE runtime
#
# Build context: REPO ROOT  (Railway Root Directory = / , Dockerfile Path =
#                            apps/worker-kotlin/Dockerfile)
#
# The worker includes observability-kotlin, graph-kotlin and skills-kotlin as
# Gradle composite builds, so all must be available inside the build context.
# recovery-kotlin is vendored into src/main/kotlin/com/vectorbea/recovery/.
# =============================================================================

# ── Stage 1: Build ────────────────────────────────────────────────────────────
#
# ── WHY THE GRADLE IMAGE AND NOT temurin + A DOWNLOAD ────────────────────────
# This stage used to be `eclipse-temurin:17-jdk-alpine` plus
# `apk add curl unzip` and a curl of the Gradle distribution. That is two
# network hops before a single line of Kotlin compiles, and both are outside
# our control:
#
#     WARNING: fetching .../v3.24/main/x86_64/APKINDEX.tar.gz: I/O error
#     ERROR: unable to select packages:
#       unzip (no such package)
#       curl-8.22.0-r0: masked in: --no-network
#
# The Alpine package index was unreachable, so the build failed before Gradle
# was ever installed — and the message ("no such package: unzip") reads like a
# missing dependency rather than a network problem, which is how it cost an
# afternoon.
#
# `gradle:8.14-jdk17-alpine` ships the JDK and the pinned Gradle already, so
# both hops are gone: the only fetches left are the base image and the Maven
# dependencies, and neither is avoidable. The version stays pinned, in the tag.
#
# The runtime stage below is unchanged and still `eclipse-temurin:17-jre-alpine`
# — it receives a jar and never sees Gradle, so the builder's flavour cannot
# reach the shipped image.
FROM gradle:8.14-jdk17-alpine AS builder

WORKDIR /workspace/apps/worker-kotlin

# Compile in the Gradle JVM using the heap configured in gradle.properties.
# Kotlin execution settings are project properties (-P on the build below).
ENV GRADLE_OPTS="-Dorg.gradle.daemon=false"

# Copy build scripts first — maximises Docker layer cache.
COPY apps/worker-kotlin/settings.gradle.kts apps/worker-kotlin/build.gradle.kts apps/worker-kotlin/gradle.properties ./
COPY packages/observability-kotlin/settings.gradle.kts packages/observability-kotlin/build.gradle.kts /workspace/packages/observability-kotlin/
COPY packages/graph-kotlin/settings.gradle.kts packages/graph-kotlin/build.gradle.kts /workspace/packages/graph-kotlin/
COPY packages/skills-kotlin/settings.gradle.kts packages/skills-kotlin/build.gradle.kts /workspace/packages/skills-kotlin/

# Pre-resolve dependencies (separate cached layer)
RUN gradle dependencies --no-daemon --console=plain --max-workers=1 -q 2>/dev/null || true

# Copy source and build fat jar. The included build must be present at the
# exact path declared in settings.gradle.kts before Gradle evaluates it.
# cache-bust: v4
COPY apps/worker-kotlin/src ./src
COPY packages/observability-kotlin/src /workspace/packages/observability-kotlin/src
COPY packages/graph-kotlin/src /workspace/packages/graph-kotlin/src
COPY packages/skills-kotlin/src /workspace/packages/skills-kotlin/src
RUN gradle fatJar --no-daemon --console=plain --max-workers=1 -Pkotlin.compiler.execution.strategy=in-process -Pkotlin.incremental=false --info --stacktrace 2>&1

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine AS runtime

LABEL org.opencontainers.image.title="vectorbea-worker"
LABEL org.opencontainers.image.description="Vectorbea Kotlin workflow worker"
LABEL org.opencontainers.image.source="https://github.com/vectorbea/vectorbea"

# Non-root user for container security
RUN addgroup -S worker && adduser -S worker -G worker

WORKDIR /app

# Copy only the fat jar — no source, no JDK, no Gradle in the final image
COPY --from=builder /workspace/apps/worker-kotlin/build/libs/*-all.jar app.jar

RUN chown worker:worker /app/app.jar
USER worker

EXPOSE 9090

ENV JAVA_OPTS="-Xms64m -Xmx384m -XX:+UseG1GC -XX:+UseContainerSupport"

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD wget -qO- http://localhost:${METRICS_PORT:-9090}/metrics | grep -q "worker_" || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
