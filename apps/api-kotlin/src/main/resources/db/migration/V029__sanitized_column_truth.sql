-- V029 — make the schema tell the truth about `_sanitized`.
--
-- Comments only. No data or structure changes.

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Tell the truth about `_sanitized` (§4.2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The investigation in docs/architecture/REPLAY-FIDELITY.md found that these
-- columns are named `_sanitized` and are NOT sanitised: `StepOutputStore.save`
-- writes `toJson(output)` with no redaction, and `RunEventStore` stores whatever
-- the caller passed.
--
-- That is good news for replay - the substrate is lossless, which is why replay is
-- byte-identical - and bad news for anyone who reads the column name and concludes
-- the content is safe to expose. Renaming is the honest fix and touches the worker,
-- the API and three repositories; it is its own change (TECH-DEBT D24). Until then
-- the schema itself says so, so a developer who checks gets the truth.

COMMENT ON COLUMN step_outputs.raw_output_json_sanitized IS
    'MISLEADING NAME: content is NOT sanitised. StepOutputStore writes the node output '
    'verbatim. Safe for replay (lossless); NOT safe to assume redacted. See D24.';
COMMENT ON COLUMN step_outputs.extracted_output_json_sanitized IS
    'MISLEADING NAME: content is NOT sanitised. See D24.';
COMMENT ON COLUMN step_outputs.validated_output_json_sanitized IS
    'MISLEADING NAME: content is NOT sanitised. See D24.';
COMMENT ON COLUMN run_events.output_json_sanitized IS
    'Sanitisation is the CALLER''s responsibility - RunEventStore stores as-is. '
    'Whether any given row is redacted depends on the call site. See D24.';
COMMENT ON COLUMN run_events.input_json_sanitized IS
    'Sanitisation is the CALLER''s responsibility - RunEventStore stores as-is. See D24.';
