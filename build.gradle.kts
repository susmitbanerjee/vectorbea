/*
 * Aggregate lifecycle tasks for the whole monorepo's Kotlin builds.
 *
 * Composite builds do not aggregate tasks automatically — an included build's `test`
 * is not wired to the root's — so each task is delegated explicitly. Adding a build
 * to settings.gradle.kts is not enough; add it to [kotlinBuilds] too.
 */
val kotlinBuilds = listOf(
    "apps/api-kotlin",
    "apps/worker-kotlin",
    "packages/observability-kotlin",
    "packages/recovery-kotlin",
)

fun aggregate(taskName: String, description: String) =
    tasks.register(taskName) {
        group = "verification"
        this.description = description
        dependsOn(kotlinBuilds.map { gradle.includedBuild(it.substringAfterLast('/')).task(":$taskName") })
    }

aggregate("test", "Runs the test suite of every Kotlin build in the monorepo.")
aggregate("build", "Builds and tests every Kotlin build in the monorepo.")
aggregate("clean", "Cleans every Kotlin build in the monorepo.")
