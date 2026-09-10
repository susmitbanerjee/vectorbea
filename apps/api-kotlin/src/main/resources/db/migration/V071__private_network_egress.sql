-- ═══════════════════════════════════════════════════════════════════════════
-- V071 — REACHING A SERVICE THAT IS NOT ON THE INTERNET
--
-- ── WHAT ALREADY WORKED, AND THE ONE THING THAT DID NOT ───────────────────
-- `HttpTransport` already binds a per-connection TLS client with a client
-- certificate, a private CA bundle, a proxy and an SNI override, sourced from
-- the secret store and cached by configuration. mTLS, in other words, is built.
--
-- It has never been reachable. `SsrfGuard` blocks every RFC1918, loopback and
-- link-local address unconditionally, and a service that requires a client
-- certificate is, almost by definition, not on a public address. So the
-- transport work terminates at a guard that refuses the only hosts it exists
-- to reach.
--
-- ── WHY THE GUARD IS RIGHT AND STILL HAS TO CHANGE ────────────────────────
-- It is not over-cautious. `169.254.169.254` is one careless tool definition
-- away from handing out cloud credentials, and a workspace member can write a
-- tool definition. Removing the check, or adding a global "allow private"
-- switch, trades a real defence for a convenience.
--
-- So the allowance is per connection, is off by default, and is USELESS ON ITS
-- OWN: turning it on without also naming the hosts it may reach changes
-- nothing. "Private egress" and "these three internal hostnames" are one
-- decision, and splitting them is how a temporary allowance becomes a permanent
-- hole.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE connections
    ADD COLUMN IF NOT EXISTS egress_policy TEXT NOT NULL DEFAULT 'public';

DO $$ BEGIN
    ALTER TABLE connections
        ADD CONSTRAINT connections_egress_policy_check
        CHECK (egress_policy IN ('public', 'private_allowed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN connections.egress_policy IS
    'public (default) = the SSRF guard applies in full, which is what every '
    'existing connection wants. private_allowed = this connection may reach '
    'RFC1918 and loopback addresses, but ONLY the hosts named in allowed_hosts, '
    'and never a cloud metadata address — that block is unconditional and is not '
    'a policy anyone can turn off.';

/*
 * ── THE ALLOW-LIST IS NOT OPTIONAL ONCE PRIVATE EGRESS IS ON ─────────────
 *
 * Enforced in the schema rather than in a route, because there is more than one
 * writer: the connections API, the test-connection flow, a support script and
 * whatever the next integration adds. A check in one of them is a check the
 * others do not have.
 *
 * `allowed_hosts` is JSONB holding an array, so "named at least one host" is
 * `jsonb_array_length(...) > 0`. A connection that flips to `private_allowed`
 * without naming a host is refused at the write, with the constraint name
 * saying which half is missing.
 */
DO $$ BEGIN
    ALTER TABLE connections
        ADD CONSTRAINT connections_private_egress_needs_hosts
        CHECK (
            egress_policy <> 'private_allowed'
            OR (jsonb_typeof(allowed_hosts) = 'array' AND jsonb_array_length(allowed_hosts) > 0)
        );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- WHO TURNED IT ON
-- ───────────────────────────────────────────────────────────────────────────
--
-- Not for tidiness. This is the one setting that widens what the platform may
-- reach from inside a customer's network, and "when did this connection start
-- being allowed to talk to 10.0.0.0/8, and who decided that" is a question a
-- security review asks and an incident asks louder. The general `audit_log`
-- records the API call; these two columns make the answer readable from the
-- connection itself, which is where somebody looks first.
ALTER TABLE connections
    ADD COLUMN IF NOT EXISTS egress_policy_set_by_user_id UUID,
    ADD COLUMN IF NOT EXISTS egress_policy_set_at TIMESTAMPTZ;

-- Finding every connection that can reach a private network. One query, for the
-- question a security review actually asks, rather than a scan with a filter
-- somebody has to remember to write.
CREATE INDEX IF NOT EXISTS connections_private_egress_idx
    ON connections (workspace_id)
    WHERE egress_policy = 'private_allowed';
