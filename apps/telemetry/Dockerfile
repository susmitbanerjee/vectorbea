FROM eclipse-temurin:17-jdk AS build
WORKDIR /app
COPY . .
RUN ./gradlew fatJar --no-daemon --console=plain \
    -Dorg.gradle.jvmargs="-Xmx512m" \
    -Dkotlin.compiler.execution.strategy=in-process

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/build/libs/*-all.jar app.jar

ENV PORT=8080
ENV APP_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["java", "-Xms64m", "-Xmx256m", "-jar", "app.jar"]
