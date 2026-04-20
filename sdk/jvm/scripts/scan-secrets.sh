#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scan-secrets.sh
# Pre-publish secret scan for com.vectorbea:vectorbea-jvm-sdk.
#
# Scans src/main and build/publications (what actually gets published) for
# patterns that indicate a real credential, internal hostname, or sensitive
# value was accidentally embedded in source or generated artifacts.
#
# Exit codes:
#   0 — clean, safe to publish
#   1 — match found, publish blocked
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

FAIL=0

red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }

# Directories to scan
SCAN_DIRS=()
[[ -d "src/main"           ]] && SCAN_DIRS+=("src/main")
[[ -d "build/publications" ]] && SCAN_DIRS+=("build/publications")

if [[ ${#SCAN_DIRS[@]} -eq 0 ]]; then
  red "✖  No scan targets found (src/main or build/publications). Run './gradlew build' first."
  exit 1
fi

echo "🔍 Scanning ${SCAN_DIRS[*]} for secrets..."

# ── Pattern definitions ───────────────────────────────────────────────────────
declare -a PATTERNS=(
  "VectorBea agent token|vbagent_[A-Za-z0-9]{20,}"
  "VectorBea live key|vb_live_[A-Za-z0-9]+"
  "VectorBea dev key|vb_dev_[A-Za-z0-9]+"
  "Supabase service role|service_role"
  "Supabase anon key|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
  "Hardcoded Authorization header|Authorization: Bearer [A-Za-z0-9+/=_.-]{20,}"
  "JWT token|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
  "Internal hostname|\.vectorbea\.internal"
  "Supabase project URL|[a-z]{20}\.supabase\.co"
  "Dotenv file content|VECTORBEA_KEY=[^\s]"
)

for entry in "${PATTERNS[@]}"; do
  label="${entry%%|*}"
  pattern="${entry##*|}"

  matches=$(grep -rEl "$pattern" "${SCAN_DIRS[@]}" 2>/dev/null || true)

  if [[ -n "$matches" ]]; then
    red "✖  [$label] — match found in:"
    while IFS= read -r file; do
      grep -En "$pattern" "$file" | while IFS= read -r line; do
        red "     $file: $line"
      done
    done <<< "$matches"
    FAIL=1
  fi
done

if [[ $FAIL -eq 1 ]]; then
  echo ""
  red "Secret scan FAILED. Fix the matches above before publishing."
  exit 1
fi

green "✔  Secret scan passed — no sensitive patterns found."
