#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scan-secrets.sh
# Pre-publish secret scan for @vectorbea-ai/node.
#
# Scans the dist/ directory (what actually gets published) for patterns that
# indicate a real credential, internal hostname, or sensitive value was
# accidentally embedded in compiled output.
#
# Exit codes:
#   0 — clean, safe to publish
#   1 — match found, publish blocked
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCAN_DIR="${1:-dist}"
FAIL=0

red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
warn()  { printf '\033[0;33m%s\033[0m\n' "$*"; }

if [[ ! -d "$SCAN_DIR" ]]; then
  red "✖  Scan target '$SCAN_DIR' does not exist. Run 'npm run build' first."
  exit 1
fi

echo "🔍 Scanning $SCAN_DIR for secrets..."

# ── Pattern definitions ───────────────────────────────────────────────────────
# Each entry: "LABEL|REGEX"
# The regex is passed to grep -E. A match in any file blocks publish.
declare -a PATTERNS=(
  # Real VectorBea tokens — placeholders like vbagent_... are allowed,
  # but a full 40+ char token is flagged.
  "VectorBea agent token|vbagent_[A-Za-z0-9]{20,}"
  "VectorBea live key|vb_live_[A-Za-z0-9]+"
  "VectorBea dev key|vb_dev_[A-Za-z0-9]+"
  # Supabase credentials
  "Supabase service role|service_role"
  "Supabase anon key|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
  # Raw auth headers
  "Hardcoded Authorization header|Authorization: Bearer [A-Za-z0-9+/=_.-]{20,}"
  # JWT-looking strings (three base64 segments separated by dots)
  "JWT token|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
  # Internal infrastructure hostnames
  "Internal hostname|\.vectorbea\.internal"
  "Supabase project URL|[a-z]{20}\.supabase\.co"
  # Environment files embedded in source
  "Dotenv file content|VECTORBEA_KEY=[^\s]"
)

for entry in "${PATTERNS[@]}"; do
  label="${entry%%|*}"
  pattern="${entry##*|}"

  matches=$(grep -rEl "$pattern" "$SCAN_DIR" 2>/dev/null || true)

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

green "✔  Secret scan passed — no sensitive patterns found in $SCAN_DIR."
