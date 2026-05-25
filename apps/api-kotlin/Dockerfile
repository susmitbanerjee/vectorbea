# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jdk-alpine AS builder

WORKDIR /build

# Copy Gradle wrapper and build files first (layer caching for dependencies)
COPY settings.gradle.kts build.gradle.kts ./

# Bootstrap Gradle wrapper inside the image
RUN apk add --no-cache curl unzip && \
    curl -L "https://services.gradle.org/distributions/gradle-8.10-bin.zip" -o gradle.zip && \
    unzip -q gradle.zip && \
    mv gradle-8.10 /opt/gradle && \
    rm gradle.zip
ENV PATH="/opt/gradle/bin:${PATH}"

# Resolve dependencies before copying source (maximises layer cache hits)
COPY src ./src
RUN gradle shadowJar --no-daemon --console=plain -q

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM eclipse-temurin:17-jre-alpine AS runtime

LABEL org.opencontainers.image.title="vectorbea-api"
LABEL org.opencontainers.image.description="Vectorbea native Kotlin API service"

# Non-root user for security
RUN addgroup -S vectorbea && adduser -S vectorbea -G vectorbea

WORKDIR /app

# Copy fat jar from builder stage
COPY --from=builder /build/build/libs/*-all.jar app.jar

# Ownership
RUN chown -R vectorbea:vectorbea /app
USER vectorbea

# Expose default port (overridable via PORT env)
EXPOSE 8080

# JVM tuning for containers:
#   -XX:+UseContainerSupport   — respect cgroup memory/CPU limits
#   -XX:MaxRAMPercentage=75    — use up to 75% of container RAM
#   -XX:+UseZGC                — low-latency GC
ENV JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0 -XX:+UseZGC"

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
