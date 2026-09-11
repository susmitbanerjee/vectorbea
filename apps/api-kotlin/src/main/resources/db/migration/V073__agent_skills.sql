-- ═══════════════════════════════════════════════════════════════════════════
-- V073 — A SKILL IS A GRANTED CAPABILITY, LIKE A TOOL
--
-- ── THE GAP THIS CLOSES ───────────────────────────────────────────────────
-- An agent granted an MCP video generation tool does not know how to make a
-- good video. The tool gives it capability; nothing gives it competence. That
-- gap is why multi-step creative and operational pipelines underperform: every
-- step can reach its API and none of them knows what good looks like.
--
-- The obvious fix — paste the competence into `agents.instructions` — works
-- exactly once. It cannot be reused by a second agent, it cannot be versioned
-- independently of the agent that happens to hold it, and nothing records that
-- a behaviour change came from the paste rather than from the agent. Three
-- agents doing related work end up with three divergent copies and no way to
-- tell which one somebody improved.
--
-- So a SKILL is a first-class entity: a named, versioned bundle of instructions
-- for a domain, the tools it requires, an output contract and worked examples.
-- Workspace-scoped, granted per agent, composed into the prompt when granted,
-- versioned independently of the agent.
--
-- ── AND THEREFORE IT INHERITS THE TOOL DISCIPLINE, NOT A NEW ONE ──────────
-- Everything below is the existing grant model applied to a second kind of
-- callable, deliberately:
--
--   · the grant check is runtime code against a database (invariant 1), never
--     a claim in a prompt;
--   · the VERSION is the unit of change (invariant 14's argument: a grant to
--     an id whose behaviour changed underneath it is a grant to something
--     nobody reviewed);
--   · lookups are workspace-scoped at the same boundary and fail closed
--     (invariant 8);
--   · the text is sanitized at the WRITE boundary (invariant 4), because a
--     customer-authored skill reaches the model's prompt exactly the way an
--     MCP tool description does — see docs/MCP.md §4 and docs/SKILLS.md §6.
--
-- Full design: docs/SKILLS.md.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. THE CURATED LIBRARY
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── WHY THE LIBRARY IS NOT JUST `skills` ROWS WITH A FLAG ─────────────────
-- A first-party skill has no workspace and therefore no tools: "call the video
-- generation tool" cannot name a uuid that exists in every customer's account.
-- A catalogue entry declares CAPABILITIES it needs — `video.generate` — and
-- installing it into a workspace is the act that binds each capability to one
-- of that workspace's tools.
--
-- That binding step is the point. It is where an operator sees exactly which
-- of their tools a platform skill is about to start instructing their agents
-- to call, before any agent holds it. A library that installed itself
-- silently would be us adding instructions to somebody's production agent.
--
-- Global, and read-only to customers. `is_first_party` is a claim only the
-- platform can make, and it is asserted by this table having no workspace
-- column at all rather than by a boolean somebody could set.
CREATE TABLE IF NOT EXISTS skill_catalog_entries (
    id                        UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    slug                      TEXT        NOT NULL,
    version                   INTEGER     NOT NULL DEFAULT 1,
    name                      TEXT        NOT NULL,
    summary                   TEXT,
    instructions              TEXT        NOT NULL,
    output_contract           TEXT,
    examples_json             JSONB       NOT NULL DEFAULT '[]',

    -- [{"key":"video.generate","label":"Video generation","why":"…"}]
    --
    -- `why` is rendered beside the tool picker at install time. An operator
    -- being asked to bind a capability deserves the skill author's reason for
    -- needing it, not just its name.
    required_capabilities_json JSONB      NOT NULL DEFAULT '[]',

    -- A short note for the library card: what this is for, when to reach for it.
    category                  TEXT,
    status                    TEXT        NOT NULL DEFAULT 'active',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT skill_catalog_entries_unique UNIQUE (slug, version),
    CONSTRAINT skill_catalog_entries_status_check CHECK (status IN ('active', 'deprecated'))
);

COMMENT ON TABLE skill_catalog_entries IS
    'The curated first-party skill library. Global and workspace-less on '
    'purpose: a platform skill cannot name a customer''s tool uuids, so it '
    'declares CAPABILITIES and installing it into a workspace is what binds '
    'each capability to one of that workspace''s tools.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. A SKILL, IN A WORKSPACE
-- ───────────────────────────────────────────────────────────────────────────
--
-- Workspace-scoped like every other grantable thing, so the lookup in the
-- loader is scoped at the same boundary as a tool's and a roster's and fails
-- closed the same way (invariant 8).
--
-- `current_version_id` mirrors `workflows.current_version_id` and
-- `tools.current_version`: the row is the identity, the version is the
-- definition, and a grant may pin either.
CREATE TABLE IF NOT EXISTS skills (
    id                 UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id       UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    environment_id     UUID        NOT NULL,
    name               TEXT        NOT NULL,
    slug               TEXT        NOT NULL,
    description        TEXT,

    /*
     * ── PROVENANCE IS A UI FACT, NOT A RUNTIME ONE ────────────────────────
     *
     * `first_party` means the platform wrote the text and a person installed
     * it from the catalogue; `customer` means somebody in the workspace wrote
     * it. A reader looking at a misbehaving agent needs to know which, because
     * the two have different people to go and ask.
     *
     * It is NOT a trust level. Both are sanitized identically and neither can
     * widen a grant, so branching on provenance in the runtime would be a trust
     * decision with nothing behind it — and would create a reason for somebody
     * to want to forge this column. Nothing reads it but the UI and the trace.
     */
    provenance         TEXT        NOT NULL DEFAULT 'customer',

    -- The catalogue entry this was installed from, when it was. Kept so the
    -- library can say "you have v2 installed, v3 is available" without matching
    -- on slugs, and so an upgrade knows what it is upgrading from.
    catalog_entry_id   UUID        REFERENCES skill_catalog_entries (id),

    current_version_id UUID,
    current_version    INTEGER     NOT NULL DEFAULT 1,
    status             TEXT        NOT NULL DEFAULT 'active',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT skills_slug_unique UNIQUE (workspace_id, environment_id, slug),
    CONSTRAINT skills_provenance_check CHECK (provenance IN ('first_party', 'customer')),
    CONSTRAINT skills_status_check CHECK (status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS skills_workspace_idx ON skills (workspace_id, environment_id, status);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. THE VERSION IS THE DEFINITION
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── WHY A SKILL IS VERSIONED AT ALL ───────────────────────────────────────
-- The same argument `tool_versions` makes, in a softer place. A tool version
-- exists because a re-import can widen a parameter under a grant; a skill
-- version exists because an author can rewrite the instructions under one. The
-- consequence is different in kind — a widened tool spends money, a rewritten
-- skill changes behaviour — but the diagnostic problem is identical: an agent
-- that behaved differently last Tuesday, with no change to the agent.
--
-- So the span attribute names `slug@v3`, not `slug`, and this table is what
-- makes that answerable months later.
--
-- A SNAPSHOT, not a diff, for `tool_versions`' reason: reconstructing v7 must
-- never be a fold over six rows.
--
-- ── THE TEXT IN HERE IS ALREADY SANITIZED ─────────────────────────────────
-- Invariant 4. `SkillSanitizer` runs at the route, before the INSERT, and
-- never at composition time — a sanitizer at render time has to run everywhere
-- the text can reach (the prompt, the UI, a version diff, a span) and the one
-- place somebody forgets is the one that matters.
CREATE TABLE IF NOT EXISTS skill_versions (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    skill_id            UUID        NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
    workspace_id        UUID        NOT NULL,
    version             INTEGER     NOT NULL,

    name                TEXT        NOT NULL,
    summary             TEXT,
    instructions        TEXT        NOT NULL,
    output_contract     TEXT,
    -- [{"title":"…","body":"…"}] — already sanitized and already bounded in
    -- count, because twenty legitimate examples is a budget attack assembled
    -- entirely from pieces that are each under their own cap.
    examples_json       JSONB       NOT NULL DEFAULT '[]',

    /*
     * ── REQUIRED TOOLS ARE UUIDS, AND THAT IS THE WHOLE POINT ─────────────
     *
     * [{"toolId":"…","label":"Video generation"}]
     *
     * By uuid because `agents.allowed_tool_ids` grants by uuid (invariant 14).
     * A requirement expressed in any other vocabulary — a name, a slug, a
     * capability — would be checked against something other than what is
     * enforced, and the refusal would drift from the grant the first time
     * somebody renamed a tool.
     *
     * The LABEL rides along rather than being looked up, so "grant the video
     * generation tool first" is still the message after the tool row is
     * deleted — which is precisely when the id alone is least useful.
     */
    required_tools_json JSONB       NOT NULL DEFAULT '[]',

    -- True when SkillSanitizer's frame-impersonation rules altered the text.
    -- NOT a rejection: a false positive would refuse a customer's own bundle on
    -- their own agent, which is worse than a defanged sentence. This is what
    -- puts a marker on the review screen instead.
    flagged_for_review  BOOLEAN     NOT NULL DEFAULT false,

    change_summary      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,

    CONSTRAINT skill_versions_unique UNIQUE (skill_id, version)
);

CREATE INDEX IF NOT EXISTS skill_versions_skill_idx ON skill_versions (skill_id, version DESC);
CREATE INDEX IF NOT EXISTS skill_versions_flagged_idx
    ON skill_versions (workspace_id, created_at DESC) WHERE flagged_for_review;

-- Added separately because `skills` is created before `skill_versions` and the
-- reference points forward. Guarded rather than bare: every other table here
-- uses IF NOT EXISTS, and a migration that is re-runnable in development is
-- worth the four extra lines.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'skills_current_version_fk'
    ) THEN
        ALTER TABLE skills
            ADD CONSTRAINT skills_current_version_fk
            FOREIGN KEY (current_version_id) REFERENCES skill_versions (id)
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. THE GRANT
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── A ROW, NOT AN ARRAY COLUMN ────────────────────────────────────────────
-- `agents.allowed_tool_ids` is a TEXT[] and the roster is a TEXT[], and this
-- deliberately is not. Three things a grant needs that an array cannot carry:
-- the ORDER it was granted in (which is the order it composes in, and which an
-- author meant when they listed research, then script, then video), the
-- VERSION it was pinned to, and who granted it. An array of ids would push all
-- three into a parallel structure that could disagree with it.
--
-- ── PINNING IS OPTIONAL, AND THE DEFAULT IS TO FOLLOW ─────────────────────
-- `skill_version_id` NULL means "whatever is current", which is what an author
-- improving their own skill wants: fix the wording once, every agent holding it
-- improves. Non-null pins, which is what an agent in production wants: nothing
-- changes underneath it until somebody says so.
--
-- The default is to follow rather than to pin because a skill is guidance, not
-- a signature — and because the version that ran is recorded per activation
-- below either way, so "which text did it actually see" stays answerable.
CREATE TABLE IF NOT EXISTS agent_skills (
    agent_id         UUID        NOT NULL REFERENCES agents (id) ON DELETE CASCADE,
    skill_id         UUID        NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
    workspace_id     UUID        NOT NULL,

    -- NULL = follow `skills.current_version_id`. Non-null = pinned.
    skill_version_id UUID        REFERENCES skill_versions (id),

    -- Composition order. Zero-based, dense by convention and not by constraint:
    -- a gap left by a revoked skill is harmless, and enforcing density would
    -- turn every revoke into a rewrite of every other row.
    position         INTEGER     NOT NULL DEFAULT 0,

    granted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by       UUID,

    PRIMARY KEY (agent_id, skill_id)
);

CREATE INDEX IF NOT EXISTS agent_skills_agent_idx ON agent_skills (agent_id, position);
CREATE INDEX IF NOT EXISTS agent_skills_skill_idx ON agent_skills (skill_id);

COMMENT ON TABLE agent_skills IS
    'Which skills an agent holds, in composition order. A grant is refused at '
    'SAVE time when the agent lacks a tool the skill requires — see '
    'SkillGrant.check — and re-checked at execution time, because a tool can be '
    'revoked a minute after the grant is written and policy is always re-read '
    '(V042''s note: the pin covers the definition, not the grant).';


-- ───────────────────────────────────────────────────────────────────────────
-- 5. WHAT WAS ACTUALLY ACTIVE, PER ACTIVATION
-- ───────────────────────────────────────────────────────────────────────────
--
-- ── WHY A TABLE AND NOT ONLY A SPAN ATTRIBUTE ─────────────────────────────
-- The span attribute exists and is the answer for a trace (§5 of the design:
-- a behaviour change must be attributable to a skill version). It is the wrong
-- answer for two other questions that get asked constantly:
--
--   · "show me the active skills on this activation" — the Debug tab's agents
--     view reads activations from Postgres, and spans may legitimately DROP
--     under back-pressure (invariant 7: a dropped span is a degraded trace).
--     A panel that is empty because the span was dropped reads as a product
--     that lost your data.
--   · "which runs used research@v3" — a query across runs, which is a row
--     scan here and a trace-store scan there.
--
-- So both, written at the same moment from the same composition result. The
-- row is authoritative for the UI; the span is authoritative for the trace.
--
-- ── SURVIVES RE-EXECUTION ─────────────────────────────────────────────────
-- Invariant 2. A step re-executes from iteration 1 on resume, so this is keyed
-- on (run, step, activation, skill) — no iteration number, no attempt, no
-- timestamp — and the write is an UPSERT. A resumed run overwrites its own row
-- with the same facts rather than accumulating one per attempt.
--
-- `activation_id` is nullable because activations are behind a flag and an
-- ordinary single-agent run has none; `step_id` is what the derived view joins
-- on in that case, exactly as `ConstellationRoutes.derivedNodes` already does.
CREATE TABLE IF NOT EXISTS agent_activation_skills (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id           UUID        NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    workspace_id     UUID        NOT NULL,
    step_id          TEXT        NOT NULL,
    activation_id    UUID,
    agent_id         UUID        NOT NULL,

    skill_id         UUID        NOT NULL,
    skill_version_id UUID,
    slug             TEXT        NOT NULL,
    version          INTEGER     NOT NULL,
    provenance       TEXT        NOT NULL DEFAULT 'customer',
    position         INTEGER     NOT NULL DEFAULT 0,

    -- How it fared in composition. A skill that was granted and then dropped
    -- under budget pressure is the failure this whole record exists to make
    -- visible: the agent "ignored" a skill it was never shown.
    included         BOOLEAN     NOT NULL DEFAULT true,
    truncated        BOOLEAN     NOT NULL DEFAULT false,
    examples_dropped BOOLEAN     NOT NULL DEFAULT false,
    chars            INTEGER     NOT NULL DEFAULT 0,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The idempotency key, as an index. COALESCE because `activation_id` is
-- nullable and NULLs do not collide in a unique index — without it, a
-- single-agent run would write a new row on every resume.
CREATE UNIQUE INDEX IF NOT EXISTS agent_activation_skills_unique
    ON agent_activation_skills (
        run_id, step_id, COALESCE(activation_id, '00000000-0000-0000-0000-000000000000'::uuid), skill_id
    );

CREATE INDEX IF NOT EXISTS agent_activation_skills_run_idx
    ON agent_activation_skills (run_id);
CREATE INDEX IF NOT EXISTS agent_activation_skills_version_idx
    ON agent_activation_skills (workspace_id, slug, version);

COMMENT ON TABLE agent_activation_skills IS
    'Which skills were composed into which activation''s prompt, and what the '
    'budget did to them. Written beside the span attribute, not instead of it: '
    'a span may be dropped under back-pressure and this may not, because the '
    'Debug tab reads it and an empty panel reads as lost data.';


-- ───────────────────────────────────────────────────────────────────────────
-- 6. THE LIBRARY, SEEDED
-- ───────────────────────────────────────────────────────────────────────────
--
-- The three skills the end-to-end scenario is built against: a research agent,
-- a script agent and a video agent, delegating down a chain and delivering
-- through a destination tool. They are seeded here rather than inserted by
-- application code so that a fresh database has a library, and so that the
-- acceptance test installs the same text a customer would.
--
-- Written as the answer to "what does a competent practitioner do first", not
-- as a description of the tool. A skill that says "call generate_video with a
-- prompt" is the tool's own description with extra steps; a skill that says
-- "write the shot list before you spend a frame of budget" is the thing the
-- model does not already know.
INSERT INTO skill_catalog_entries (slug, version, name, summary, category, instructions, output_contract, required_capabilities_json, examples_json)
VALUES
(
    'research-brief', 1, 'Research brief',
    'Turn a loose question into a sourced brief a writer can work from.',
    'research',
    'You are producing a BRIEF, not an essay. A brief is what somebody downstream works from, so it is judged on whether they can start writing immediately.

Work in this order.

1. Restate the question in one sentence. If the request is ambiguous, state the reading you are taking and proceed on it — do not stop to ask, and do not answer two readings at once.
2. Search before you assert. Every claim that a reader could dispute needs a source. Claims you cannot source go in a separate "unverified" list rather than being softened into the body; hedged prose is how an unsourced claim survives review.
3. Prefer primary sources and recent ones. When two sources disagree, say so and say which you are using.
4. Stop searching when the next search stops changing the brief. Three good sources beat nine overlapping ones, and every extra call costs the run budget somebody is paying for.
5. Write at most eight findings. A brief longer than a page is a document nobody downstream reads.

Never invent a statistic, a date, a quotation or a source. An empty finding is recoverable; a fabricated one is discovered by the reader, after publication.',
    'A JSON object with: question (one sentence), findings (array of {claim, source, confidence}), unverified (array of strings), and angles (2-4 suggested directions for the piece). Every finding has a source URL. No prose outside the object.',
    '[{"key":"web.search","label":"Web search","why":"Every claim in the brief needs a source, and the skill refuses to assert what it cannot look up."}]',
    '[{"title":"An ambiguous request","body":"Asked for \"something about batteries\", state the reading — \"recent grid-storage cost trends\" — in the question field, then research that. Do not produce three shallow briefs."}]'
),
(
    'video-script', 1, 'Short-form video script',
    'Turn a brief into a shot-by-shot script a generator can actually shoot.',
    'creative',
    'You are writing for a VIDEO GENERATOR, not for a reader. The difference is the whole skill: a generator cannot infer, cannot hold a thought across shots, and renders exactly the noun you gave it.

Work in this order.

1. Decide the single idea the video carries. One. A script carrying two ideas produces a video that lands neither.
2. Write the first three seconds first. They are the only three seconds you are guaranteed to get, and they must contain the idea, not a wind-up to it.
3. Break the script into shots of 3-8 seconds. Each shot names: the subject, what the camera does, the lighting, and the spoken line over it. A shot missing any of the four will be generated as somebody else''s guess.
4. Keep the subject description IDENTICAL across shots, word for word. A generator re-reads the description per shot and a paraphrase produces a different person.
5. Write narration as spoken language. Read every line aloud in your head; anything you stumble over, the narrator will too.
6. Total the durations. If the total exceeds the brief''s target, cut a shot rather than shortening all of them — a rushed video reads as cheap, a shorter one does not.

Never write a shot you cannot describe concretely. "A montage of progress" is not a shot; it is an instruction to somebody who does not exist.',
    'A JSON object with: idea (one sentence), totalSeconds (number), shots (array of {index, seconds, subject, camera, lighting, narration}). Subject text is identical across every shot describing the same subject.',
    '[]',
    '[{"title":"A shot the generator cannot shoot","body":"\"A montage of progress\" is not a shot. Replace it with: subject \"a technician in a blue coat\", camera \"slow push in\", lighting \"overcast daylight\", narration \"it took four years\"."}]' 
),
(
    'video-production', 1, 'Video production',
    'Spend a generation budget in the order that catches mistakes while they are cheap.',
    'creative',
    'Generating video is the most expensive thing this agent does, and the cost is paid per attempt whether or not the attempt was worth making. The skill is the ORDER, not the API call.

Work in this order.

1. Read the whole script before generating anything. A script whose shots contradict each other produces a video nobody can fix in post; send it back rather than shooting it.
2. Generate SHOT ONE ALONE and stop. Look at what came back. Wrong subject, wrong aspect ratio, wrong tone — all of it is visible in the first shot, and all of it is about to be repeated across every other shot at full price.
3. Only when shot one is right, generate the rest. Reuse the exact subject wording from the script; do not improve it between shots, because consistency is worth more than any single improvement.
4. Generation is asynchronous. Submit, then wait for the result rather than re-submitting — a re-submission does not arrive sooner and is billed twice.
5. If a shot fails twice for the same reason, stop and report what failed with the shot text. A third attempt at an impossible prompt costs the same as the first two and tells nobody anything.
6. Report total shots, total seconds and every asset reference. Downstream delivery needs the references, and a run that produced eight files and reported none of them produced nothing.

Never silently drop a shot. A six-shot video delivered as five is a defect that looks like a creative choice.',
    'A JSON object with: shots (array of {index, assetRef, seconds, status}), totalSeconds, and failures (array of {index, reason}). Every shot in the script appears exactly once, in either shots or failures.',
    '[{"key":"video.generate","label":"Video generation","why":"The skill is about how to spend generation budget, so it is meaningless without the tool that spends it."}]',
    '[]'
)
ON CONFLICT (slug, version) DO NOTHING;
