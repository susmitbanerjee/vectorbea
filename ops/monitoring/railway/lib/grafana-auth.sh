# shellcheck shell=sh
#
# Grafana access control. SOURCED, not executed — it exports variables into the
# caller's environment and returns.
#
# ── WHY THIS IS A SHARED FILE ────────────────────────────────────────────────
# Two entrypoints need it: the all-in-one container and the standalone Grafana
# image. Copying the logic into both would be fine right up until someone fixes a
# detail in one of them, and the detail here is who is allowed to read per-workspace
# cost data. A security check that exists twice is a security check that will
# eventually disagree with itself.
#
# ── WHY GRAFANA'S OWN SETTINGS CANNOT DO THIS ────────────────────────────────
# Grafana has no "allowed emails" setting. It has `allowed_domains`, which is worse
# than useless here: the address to admit is a gmail.com address, so
# `allowed_domains = gmail.com` would admit EVERY GOOGLE ACCOUNT ON EARTH while
# reading, in a config file, exactly like access control.
#
# What it does have is `role_attribute_path` — a JMESPath expression evaluated against
# the OAuth userinfo response, whose result becomes the user's role. With
# `role_attribute_strict`, an expression yielding nothing DENIES the login instead of
# falling back to a default role. That is the only mechanism in Grafana that actually
# refuses people, so the allow-list is expressed as a role mapping.

grafana_auth_configure() {
  ALLOWED="${GRAFANA_ALLOWED_EMAILS:-}"
  if [ -z "$ALLOWED" ]; then
    echo "FATAL: GRAFANA_ALLOWED_EMAILS is not set." >&2
    echo "       Refusing to start rather than serving per-workspace cost data to" >&2
    echo "       whoever signs in. Set it to a comma-separated list of addresses." >&2
    return 1
  fi

  # "a@x.com, b@y.com"  ->  'a@x.com','b@y.com'
  EMAIL_LIST=""
  OLD_IFS="$IFS"
  IFS=','
  for raw in $ALLOWED; do
    addr=$(printf '%s' "$raw" | tr -d ' \t')
    [ -z "$addr" ] && continue
    # A single quote would break out of the JMESPath string literal. No legitimate
    # address needs one, so this is refused rather than escaped.
    case "$addr" in
      *"'"*) echo "FATAL: address '$addr' contains a quote character." >&2; return 1 ;;
    esac
    if [ -z "$EMAIL_LIST" ]; then EMAIL_LIST="'$addr'"; else EMAIL_LIST="$EMAIL_LIST,'$addr'"; fi
  done
  IFS="$OLD_IFS"

  if [ -z "$EMAIL_LIST" ]; then
    echo "FATAL: GRAFANA_ALLOWED_EMAILS contained no usable addresses." >&2
    return 1
  fi

  if [ -z "$GRAFANA_OAUTH_CLIENT_ID" ]; then
    # Local admin only. Correct for local development, NOT acceptable on a public
    # domain — a shared password is not an identity and cannot deny anyone by email.
    # Said loudly, because this is the state someone reaches by forgetting one variable.
    echo "[grafana] GRAFANA_OAUTH_CLIENT_ID unset — local admin login only." >&2
    echo "[grafana] Sign in with username 'admin' and the value of" >&2
    echo "[grafana] GF_SECURITY_ADMIN_PASSWORD. This form is Grafana's own — it is NOT" >&2
    echo "[grafana] Google, and a Google password will never work here." >&2
    echo "[grafana] Access is NOT restricted by email in this mode. Do not use it on a" >&2
    echo "[grafana] public domain. See ops/monitoring/railway/README.md section 4." >&2
    export GF_AUTH_DISABLE_LOGIN_FORM="false"

    # ── A note for whoever tries to improve this ──────────────────────────────
    # The obvious fix for "someone typed their Google password into Grafana's local
    # form" is to label the form. `[auth] login_hint` and `password_hint` look like
    # exactly that, and they are still listed in Grafana 11.2's defaults.ini.
    #
    # THEY DO NOTHING. Setting GF_AUTH_LOGIN_HINT / GF_AUTH_PASSWORD_HINT was tried:
    # the variables reach the process, and `/api/admin/settings` reports both as null
    # while the rendered login page contains neither string. The React login form uses
    # fixed placeholders in this version.
    #
    # So the guidance lives in the startup log above and in README §4, and the real
    # fix is to configure OAuth — at which point this form is not rendered at all.
    return 0
  fi

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
  # has no account to attach to and fails. Not a hole: the role expression runs BEFORE
  # the account is created, so an address that does not match never gets one.
  export GF_AUTH_GENERIC_OAUTH_ALLOW_SIGN_UP="true"

  # THE ALLOW-LIST.
  #
  # JMESPath `&&` yields its right-hand side when the left is truthy, so a matching,
  # verified address evaluates to "Admin" and anything else evaluates to false. With
  # strict mode on, false means no role, and no role means the login is refused.
  #
  # `email_verified` is checked first and deliberately: Google returns an unverified
  # address on some account types, and an unverified address is a claim, not an identity.
  export GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH="email_verified && contains([$EMAIL_LIST], email) && 'Admin'"
  export GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_STRICT="true"

  # No auto-assignment anywhere. Both are fallbacks that would hand a role to someone
  # the expression above declined to give one to.
  export GF_USERS_AUTO_ASSIGN_ORG_ROLE="None"
  export GF_AUTH_OAUTH_SKIP_ORG_ROLE_UPDATE_SYNC="false"

  # The local password form is off: it is a second door OAuth does not guard, and
  # "only this address" is not true while anyone with the admin password can use it.
  # GRAFANA_BREAK_GLASS=true is the documented recovery from an OAuth misconfiguration.
  if [ "$GRAFANA_BREAK_GLASS" = "true" ]; then
    echo "[grafana] WARNING: break-glass mode — the local admin login form is ENABLED." >&2
    echo "[grafana] WARNING: turn this off once OAuth is working." >&2
    export GF_AUTH_DISABLE_LOGIN_FORM="false"
  else
    export GF_AUTH_DISABLE_LOGIN_FORM="true"
  fi
}
