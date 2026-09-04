rootProject.name = "vectorbea"

/*
 * An AGGREGATOR, not a parent build.
 *
 * Each Kotlin service already builds and ships on its own — CI runs them as separate
 * jobs with `working-directory`, and both Dockerfiles invoke Gradle inside their own
 * directory. Turning them into subprojects would break all of that.
 *
 * `includeBuild` keeps every child build exactly as it is (own settings, own wrapper,
 * own lifecycle) and adds one place to run them all from. `./gradlew test` at the repo
 * root now runs every Kotlin test in the monorepo; `cd apps/worker-kotlin && ./gradlew
 * test` still works unchanged.
 *
 * observability-kotlin is deliberately absent: both services already includeBuild it,
 * and including it here as well makes Gradle resolve the same build twice.
 */
includeBuild("apps/api-kotlin")
includeBuild("apps/worker-kotlin")
includeBuild("packages/observability-kotlin")
includeBuild("packages/recovery-kotlin")
includeBuild("packages/graph-kotlin")
