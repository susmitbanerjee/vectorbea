# Deprecated scripts

## build-multi-arch.sh

Originally built a multi-architecture Docker image for the **vectorbea-proxy**,
a GraalVM/JVM sidecar that was part of an earlier architecture.

**This script is no longer used.** The proxy was removed when the architecture
was simplified to a pure Node.js stack. See `docs/product-direction.md` for
the full pivot rationale ("GraalVM / JVM sidecar proxy" is listed under
"Out of scope").

The script is kept here for reference only and should not be run.
