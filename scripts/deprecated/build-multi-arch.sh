#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-multi-arch.sh
#
# Build and push a multi-architecture VectorBea proxy image to Docker Hub.
# Targets linux/amd64 (standard cloud VMs) and linux/arm64 (Apple Silicon /
# AWS Graviton). Uses the JVM Dockerfile so both arches build from the same
# platform-neutral JAR with no QEMU overhead for the compilation step.
#
# Usage:
#   ./scripts/build-multi-arch.sh                  # pushes :latest
#   ./scripts/build-multi-arch.sh 1.2.3            # pushes :1.2.3 and :latest
#   DRY_RUN=1 ./scripts/build-multi-arch.sh 1.2.3  # prints commands, no push
#
# Requirements:
#   - Docker Desktop or Docker Engine with Buildx plugin installed
#   - Logged in to Docker Hub: docker login
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

REGISTRY="vectorbea/vectorbea-proxy"
VERSION="${1:-}"
BUILDER_NAME="vectorbea-multiarch"
PLATFORMS="linux/amd64,linux/arm64"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_DIR="$(cd "${SCRIPT_DIR}/../vectorbea-proxy" && pwd)"
DRY_RUN="${DRY_RUN:-0}"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "▶ $*"; }
die()  { echo "✖ $*" >&2; exit 1; }
run()  {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[DRY RUN] $*"
  else
    "$@"
  fi
}

# ── Preflight checks ──────────────────────────────────────────────────────────

command -v docker >/dev/null 2>&1 || die "Docker not found. Install Docker Desktop or Docker Engine."
docker info >/dev/null 2>&1       || die "Docker daemon is not running."

# ── Ensure the builder exists and supports multi-platform ────────────────────
#
# The default 'docker' driver cannot build multi-platform images. We create a
# dedicated builder backed by the 'docker-container' driver, which runs in a
# container with QEMU binfmt_misc support for cross-platform emulation.
#
# --bootstrap initialises the builder immediately so any setup errors surface
# here rather than during the build step.

if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
  log "Creating buildx builder '${BUILDER_NAME}'..."
  run docker buildx create \
    --name "$BUILDER_NAME" \
    --driver docker-container \
    --driver-opt network=host \
    --bootstrap
else
  log "Builder '${BUILDER_NAME}' already exists — reusing."
fi

run docker buildx use "$BUILDER_NAME"

# ── Build and push ────────────────────────────────────────────────────────────

# Assemble tags: always push :latest; also push a version tag if provided.
TAGS=("-t" "${REGISTRY}:latest")
if [[ -n "$VERSION" ]]; then
  TAGS+=("-t" "${REGISTRY}:${VERSION}")
  log "Building ${REGISTRY}:${VERSION} and :latest for ${PLATFORMS}"
else
  log "Building ${REGISTRY}:latest for ${PLATFORMS} (pass a version as \$1 to also tag a version)"
fi

# --platform=$BUILDPLATFORM is set inside the Dockerfile's builder stage so
# Gradle always runs natively. Here we target both arches for the runtime stage.
run docker buildx build \
  --platform "$PLATFORMS" \
  "${TAGS[@]}" \
  --file "${PROXY_DIR}/Dockerfile" \
  --push \
  "${PROXY_DIR}"

log "Done. Pull the image on any platform with:"
echo ""
echo "  docker pull ${REGISTRY}:${VERSION:-latest}"
echo ""
echo "Docker resolves the correct architecture automatically — no --platform flag needed."
