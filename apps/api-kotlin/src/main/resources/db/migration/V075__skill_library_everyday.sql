-- ===========================================================================
-- V075 — everyday skills in the library
--
-- See docs/SKILLS.md §7.
--
-- ── WHY THESE ───────────────────────────────────────────────────────────────
-- V073 seeded the library with the skills its acceptance pipeline needed —
-- research, video script, video production — and two of the three need a tool
-- bound before they install. So the library a new workspace opened had nothing
-- that could be added to an ordinary agent in one click, and "skills" read as a
-- feature for video pipelines.
--
-- The skills people reach for first are about HOW an agent works on any job:
-- spend fewer tokens, answer in a shape a machine can read, write like a
-- careful person, look at a design like a designer. None of them needs a tool,
-- so each installs and applies immediately, on any model.
--
-- ── HOW THEY ARE WRITTEN ────────────────────────────────────────────────────
-- The same rule as V073: the answer to "what does a competent practitioner do",
-- not a description of the task. Ordered steps, the failure each step prevents,
-- and the one thing never to do. No text shaped like a prompt frame — the
-- sanitizer would defang it on install, and a first-party skill that arrives
-- with [removed] markers in it teaches nobody anything.
--
-- Additive and idempotent: ON CONFLICT (slug, version) DO NOTHING, so a
-- database that already has any of these keeps what it has.
-- ===========================================================================

INSERT INTO skill_catalog_entries (slug, version, name, summary, category, instructions, output_contract, required_capabilities_json, examples_json)
VALUES
(
    'token-efficient', 1, 'Token-efficient answers',
    'Say the same thing in far fewer tokens: no preamble, no restating, no filler.',
    'efficiency',
    'Every token you write is paid for and read by someone. Spend them on the answer.

Work in this order.

1. Lead with the answer. Do not restate the question, announce what you are about to do, or thank anyone.
2. Use the shortest form that is still unambiguous: a number instead of a sentence about the number, a list only when there are three or more items, a table only when the reader must compare across rows.
3. Cut every sentence that would not be missed. Hedges ("it seems", "it may be worth noting"), summaries of what you just said, and offers of further help are the usual ones.
4. When thinking through a problem, keep intermediate reasoning to what the next step needs. Do not narrate each step of work that succeeded.
5. When calling tools, request only the fields and rows you will use, and do not call a tool again for information you already have.

Never drop a fact, a caveat that changes the decision, or a required field to save tokens. Short and wrong costs more than long and right.',
    NULL,
    '[]',
    '[{"title":"Before and after","body":"Before: \"Great question! Based on the data you provided, it looks like the total revenue for March comes to approximately $41,200, which represents an increase.\" After: \"March revenue: $41,200 (+8% vs February).\""}]'
),
(
    'structured-json', 1, 'Structured JSON output',
    'Return exactly one valid JSON object that a program can parse, every time.',
    'data',
    'The reader of your answer is a program. A program cannot skip a sentence of explanation or guess at a missing brace, so the whole skill is being exact.

Work in this order.

1. Decide the shape before writing: which keys, which types, which are required. If an output schema was given, that shape is fixed; follow it exactly, including key names and casing.
2. Return one JSON object and nothing else. No prose before or after it, no code fences, no comments inside it.
3. Use the right types: numbers as numbers, booleans as true or false, dates as ISO-8601 strings, absent values as null rather than an empty string or the word "none".
4. Keep every required key, even when you have no value for it; use null and, if the schema allows, add a short reason field rather than dropping the key.
5. Escape strings correctly. Quotes and newlines inside a value are the most common reason a reply fails to parse.

Never invent a value to fill a required field. A null a program can handle is better than a plausible number nobody measured.',
    'A single JSON object, parseable as-is, with no surrounding text.',
    '[]',
    '[]'
),
(
    'clear-writing', 1, 'Clear, human writing',
    'Write for a busy reader: plain words, short sentences, the point first.',
    'writing',
    'Write the way a careful person explains something to a colleague who has two minutes.

Work in this order.

1. Put the point in the first sentence. If the reader stops there, they should still have what they need.
2. Use plain words. Replace jargon with what it means unless the reader uses that jargon themselves.
3. Keep sentences short, one idea each. Break a sentence that needs a semicolon into two.
4. Use active voice and name who does what: "the billing team refunds the charge", not "the charge will be refunded".
5. Match the reader''s situation. A customer who is upset needs acknowledgement and a next step before an explanation; an engineer needs the exact error before the context.
6. Read it once as the recipient before finishing. Remove anything that is about you rather than them.

Never promise what you cannot confirm — a date, a refund, a fix. Say what will happen next and when you will know more.',
    NULL,
    '[]',
    '[]'
),
(
    'design-critique', 1, 'Design critique',
    'Review a screen, flow or layout the way a senior product designer would.',
    'design',
    'A useful critique names what is wrong, why it matters to the person using it, and what to change. Taste alone is not a finding.

Work in this order.

1. State what the design is for and who uses it, in one sentence. Judge everything against that, not against your preferences.
2. Check hierarchy first: what does the eye land on, and is that the most important thing? Then check the primary action: is it obvious, and is there only one?
3. Check the states the mockup usually leaves out: empty, loading, error, very long text, no permission. Missing states are the most common real defect.
4. Check consistency: spacing on a regular scale, type sizes from a small set, colours used for one meaning each, and the same component looking the same everywhere.
5. Check accessibility: body text contrast at least 4.5:1, touch targets at least 44px, focus visible on every control, and nothing that relies on colour alone.
6. Write each finding as: what you saw, why it hurts the user, and the specific change. Order findings by impact, most severe first, and keep to the ones that matter.

Never pad a critique with praise or with minor nitpicks to seem thorough. Three findings someone will act on beat fifteen they will skim.',
    'A short list of findings, most severe first. Each has: issue, impact on the user, and the recommended change.',
    '[]',
    '[{"title":"A useful finding","body":"Issue: the \"Delete project\" button uses the same primary style as \"Save\". Impact: a destructive action looks like the expected next step, so people will click it by habit. Change: make Delete a secondary danger button and move it away from Save."}]'
),
(
    'careful-reasoning', 1, 'Check your work',
    'Verify answers before giving them: re-check numbers, sources and assumptions.',
    'quality',
    'Most wrong answers are not hard problems solved badly; they are easy steps nobody went back to check. This skill is the going back.

Work in this order.

1. Before answering, list the assumptions the answer depends on. If one is uncertain and changes the result, say so explicitly rather than choosing silently.
2. Recompute every number in a second way where one exists — add the parts back up, reverse the calculation, check units and orders of magnitude.
3. Check each claim against where it came from. If a claim came from a tool result, quote the field; if it came from memory and the stakes are real, say it is unverified.
4. Look for the answer being right for the wrong reason: a total that matches only because two errors cancel, a date in the wrong timezone, a list missing its last page.
5. Only then write the answer, and state your confidence in one phrase when it is less than high.

Never present a guess as a finding. "I could not verify this" is an answer; a confident wrong number is a defect someone else pays for.',
    NULL,
    '[]',
    '[]'
),
(
    'support-reply', 1, 'Customer support reply',
    'Answer a customer so the issue is resolved or clearly moving, in one message.',
    'support',
    'A good support reply leaves the customer knowing exactly where they stand. Tone matters, but it follows from being clear and specific.

Work in this order.

1. Acknowledge the specific problem in their words, in one sentence. Not a generic apology.
2. Give the answer or the fix first. If there are steps, number them and keep each to one action.
3. If you cannot fix it now, say what happens next, who does it, and when they will hear back.
4. Ask for missing information only if you truly need it, and ask for all of it at once, not one question per message.
5. Close with nothing more than a sentence. No "don''t hesitate to reach out", no signature block unless one is required.

Never blame the customer, speculate about causes you have not confirmed, or promise a refund, credit or date you are not authorised to give.',
    NULL,
    '[]',
    '[]'
)
ON CONFLICT (slug, version) DO NOTHING;
