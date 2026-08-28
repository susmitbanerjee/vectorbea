# =============================================================================
# vectorbea-api — Kotlin API service
# Multi-stage build: Gradle fat-jar → JRE runtime
#
# Build context: REPO ROOT  (Railway Root Directory = / , Dockerfile Path =
#                            apps/api-kotlin/Dockerfile)
#
# The context is the repo root and NOT apps/api-kotlin, because
# settings.gradle.kts declares a composite build:
#
#     includeBuild("../../packages/observability-kotlin")
#
# Docker cannot read anything outside its build context, so with the context set
# to apps/api-kotlin that path can never resolve and Gradle fails during
# settings evaluation with "A path must be specified!".
#
# Layout inside the image mirrors the repository so every relative Gradle path
# resolves exactly as it does in CI and local development:
#     /workspace/apps/api-kotlin    → apps/api-kotlin
#     /workspace/apps/worker-kotlin → worker contract sources used by the API
#     /workspace/packages           → shared Gradle builds
#
# recovery-kotlin is vendored into src/main/kotlin/com/vectorbea/recovery/ and
# needs nothing here.
# =============================================================================

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jdk-alpine AS builder

WORKDIR /workspace/apps/api-kotlin

# Install Gradle (pinned version for reproducible builds)
ARG GRADLE_VERSION=8.10
RUN apk add --no-cache curl unzip && \
    curl -fL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
         -o /tmp/gradle.zip && \
    unzip -q /tmp/gradle.zip -d /opt && \
    mv /opt/gradle-${GRADLE_VERSION} /opt/gradle && \
    rm /tmp/gradle.zip
ENV PATH="/opt/gradle/bin:${PATH}"

# Limit JVM heap for Gradle + Kotlin compiler to stay within Railway build limits.
# --no-daemon already prevents a second JVM, but the single Gradle JVM still needs
# explicit caps or it will try to use ~25% of total RAM and OOM-kill silently.
ENV GRADLE_OPTS="-Dorg.gradle.jvmargs=-Xmx512m -Dorg.gradle.daemon=false -Dkotlin.compiler.execution.strategy=in-process -Dkotlin.incremental=false"

# Copy build scripts first — maximises Docker layer cache.
# Source code changes won't invalidate the dependency resolution layer.
COPY apps/api-kotlin/settings.gradle.kts apps/api-kotlin/build.gradle.kts ./
COPY packages/observability-kotlin/settings.gradle.kts packages/observability-kotlin/build.gradle.kts /workspace/packages/observability-kotlin/

# Pre-resolve Gradle dependencies (separate cached layer)
RUN gradle dependencies --no-daemon --console=plain --max-workers=1 -q 2>/dev/null || true

# Copy source and build fat jar. The included build must be present at the
# exact path declared in settings.gradle.kts before Gradle evaluates it.
# cache-bust: v3
COPY apps/api-kotlin/src ./src
COPY apps/worker-kotlin/src/main/kotlin/com/vectorbea/crypto /workspace/apps/worker-kotlin/src/main/kotlin/com/vectorbea/crypto
COPY apps/worker-kotlin/src/main/kotlin/com/vectorbea/dbcatalog /workspace/apps/worker-kotlin/src/main/kotlin/com/vectorbea/dbcatalog
COPY apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/contract /workspace/apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/contract
COPY packages/observability-kotlin/src /workspace/packages/observability-kotlin/src
RUN gradle fatJar --no-daemon --console=plain --max-workers=1 --info --stacktrace 2>&1

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine AS runtime

LABEL org.opencontainers.image.title="vectorbea-api"
LABEL org.opencontainers.image.description="Vectorbea Kotlin API service"
LABEL org.opencontainers.image.source="https://github.com/vectorbea/vectorbea"

# Non-root user for container security
RUN addgroup -S vectorbea && adduser -S vectorbea -G vectorbea

WORKDIR /app

# Copy fat jar from build stage — no source, no JDK, no Gradle in the image
COPY --from=builder /workspace/apps/api-kotlin/build/libs/*-all.jar app.jar

RUN chown vectorbea:vectorbea /app/app.jar
USER vectorbea

# API port (overridable via PORT env var)
EXPOSE 8080

ENV JAVA_OPTS="-Xms64m -Xmx256m -XX:+UseG1GC -XX:+UseContainerSupport"

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD wget -qO- http://localhost:${PORT:-8080}/health || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar app.jar"]
