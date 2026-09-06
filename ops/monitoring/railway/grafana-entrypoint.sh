#!/bin/sh
#
# Grafana startup: bind the Railway-assigned port, and build the access allow-list.
#
# ── WHY THE ALLOW-LIST IS BUILT HERE AND NOT WRITTEN IN A CONFIG FILE ────────
# Grafana has no "allowed emails" setting. It has `allowed_domains`, which is useless
# for this case: the address to admit is a gmail.com address, and
# `allowed_domains = gmail.com` would admit EVERY GOOGLE ACCOUNT ON EARTH. That is
# not a smaller mistake than leaving it open — it is the same mistake with a config
# line that makes it look handled.
#
# What Grafana does have is `role_attribute_path`: a JMESPath expression evaluated
# against the OAuth userinfo response, whose result becomes the user's role. Paired
# with `role_attribute_strict`, an expression that yields nothing DENIES THE LOGIN
# rather than falling back to a default role. So the allow-list is expressed as a role
# mapping, which is the only mechanism that actually refuses people.
#
# It is assembled from an environment variable rather than hardcoded so that adding or
# removing someone is a Railway variable change, not a commit and a redeploy of an
# image.

set -e

# Railway assigns the listening port at runtime; Grafana reads GF_SERVER_HTTP_PORT.
# The fallback keeps `docker run` and the compose file working unchanged.
export GF_SERVER_HTTP_PORT="${PORT:-3000}"

# ── Build the JMESPath list ─────────────────────────────────────────────────
# "a@x.com, b@y.com"  ->  'a@x.com','b@y.com'
ALLOWED="${GRAFANA_ALLOWED_EMAILS:-}"
if [ -z "$ALLOWED" ]; then
  echo "FATAL: GRAFANA_ALLOWED_EMAILS is not set." >&2
  echo "       Refusing to start rather than serving per-workspace cost data to" >&2
  echo "       whoever signs in. Set it to a comma-separated list of addresses." >&2
  exit 1
fi

EMAIL_LIST=""
OLD_IFS="$IFS"
IFS=','
for raw in $ALLOWED; do
  addr=$(printf '%s' "$raw" | tr -d ' \t')
  [ -z "$addr" ] && continue
  # A single quote inside an address would break out of the JMESPath string literal.
  # No legitimate address needs one, so this is refused rather than escaped.
  case "$addr" in
    *"'"*) echo "FATAL: address '$addr' contains a quote character." >&2; exit 1 ;;
  esac
  if [ -z "$EMAIL_LIST" ]; then EMAIL_LIST="'$addr'"; else EMAIL_LIST="$EMAIL_LIST,'$addr'"; fi
done
IFS="$OLD_IFS"

if [ -z "$EMAIL_LIST" ]; then
  echo "FATAL: GRAFANA_ALLOWED_EMAILS contained no usable addresses." >&2
  exit 1
fi

if [ -n "$GRAFANA_OAUTH_CLIENT_ID" ]; then
  # ── Identity-based access, the real thing ─────────────────────────────────
  echo "[grafana] OAuth enabled; access restricted to: $ALLOWED"

  export GF_AUTH_GENERIC_OAUTH_ENABLED="true"
  export GF_AUTH_GENERIC_OAUTH_NAME="Google"
  export GF_AUTH_GENERIC_OAUTH_CLIENT_ID="$GRAFANA_OAUTH_CLIENT_ID"
  export GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET="$GRAFANA_OAUTH_CLIENT_SECRET"
  export GF_AUTH_GENERIC_OAUTH_SCOPES="openid email profile"
  export GF_AUTH_GENERIC_OAUTH_AUTH_URL="https://accounts.google.com/o/oauth2/v2/auth"
  export GF_AUTH_GENERIC_OAUTH_TOKEN_URL="https://oauth2.googleapis.com/token"
  export GF_AUTH_GENERIC_OAUTH_API_URL="https://openidconnect.googleapis.com/v1/userinfo"
  export GF_AUTH_GENERIC_OAUTH_EMAIL_ATTRIBUTE_PATH="email"

  # Sign-up must be allowed for OAuth, or the very first login by the allowed address
  # has no account to attach to and fails. It is not a hole: the role expression below
  # runs BEFORE the account is created, so an address that does not match never gets
  # one. `[users] allow_sign_up` stays false — that governs the local form.
  export GF_AUTH_GENERIC_OAUTH_ALLOW_SIGN_UP="true"

  # THE ALLOW-LIST.
  #
  #   email_verified && contains(['…'], email) && 'Admin'
  #
  # JMESPath `&&` yields its right-hand side when the left is truthy, so a matching,
  # verified address evaluates to the string "Admin" and anything else evaluates to
  # false. With strict mode on, false means no role, and no role means the login is
  # refused with "user does not have a valid role".
  #
  # `email_verified` is checked first and deliberately: Google will return an
  # unverified address on some account types, and an unverified address is a claim,
  # not an identity.
  export GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH="email_verified && contains([$EMAIL_LIST], email) && 'Admin'"
  export GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_STRICT="true"

  # No auto-assignment anywhere. Both of these are fallbacks that would hand a role to
  # someone the expression above declined to give one to.
  export GF_USERS_AUTO_ASSIGN_ORG_ROLE="None"
  export GF_AUTH_OAUTH_SKIP_ORG_ROLE_UPDATE_SYNC="false"

  # ── The local password form ───────────────────────────────────────────────
  # Off by default: it is a second door that OAuth does not guard, and "only this
  # address" is not true while anyone holding the admin password can walk through it.
  #
  # GRAFANA_BREAK_GLASS=true re-enables it. That is the documented recovery path for
  # an OAuth misconfiguration — a Railway variable change and a redeploy, a few
  # minutes — and it is far better than being locked out of the monitoring during the
  # incident that made you want to look at it.
  if [ "$GRAFANA_BREAK_GLASS" = "true" ]; then
    echo "[grafana] WARNING: break-glass mode — the local admin login form is ENABLED." >&2
    echo "[grafana] WARNING: turn this off once OAuth is working." >&2
    export GF_AUTH_DISABLE_LOGIN_FORM="false"
  else
    export GF_AUTH_DISABLE_LOGIN_FORM="true"
  fi
else
  # ── No OAuth configured ───────────────────────────────────────────────────
  # Local admin only. Correct for local development, and NOT acceptable on a public
  # domain — a shared password is not an identity, and it cannot deny anyone by email.
  # Said loudly rather than silently, because this is the state someone could deploy
  # by forgetting one variable.
  echo "[grafana] GRAFANA_OAUTH_CLIENT_ID unset — local admin login only." >&2
  echo "[grafana] Access is NOT restricted by email in this mode. Do not use it on a" >&2
  echo "[grafana] public domain. See ops/monitoring/railway/README.md section 4." >&2
  export GF_AUTH_DISABLE_LOGIN_FORM="false"
fi

exec /run.sh "$@"
