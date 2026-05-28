#!/usr/bin/env bash
# Portable Gradle runner — uses gradlew if present in the current directory,
# falls back to the system `gradle` binary.
# Usage: scripts/gradle.sh <task> [args...]
set -euo pipefail
if [ -f "./gradlew" ]; then
  exec ./gradlew "$@"
else
  exec gradle "$@"
fi
