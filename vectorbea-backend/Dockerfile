# syntax=docker/dockerfile:1.7

FROM gradle:8.10.2-jdk21 AS builder

WORKDIR /workspace

COPY build.gradle.kts settings.gradle.kts ./
COPY supabase ./supabase
COPY src ./src

RUN gradle --no-daemon fatJar

FROM eclipse-temurin:21-jre-alpine AS runner

WORKDIR /app

RUN addgroup -S vectorbea && adduser -S vectorbea -G vectorbea

COPY --from=builder /workspace/build/libs/*-all.jar /app/vectorbea-backend.jar

USER vectorbea

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/vectorbea-backend.jar"]
