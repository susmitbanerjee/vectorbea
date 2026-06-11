-- Seed default system-level policy packs (workspace_id IS NULL = global/system)
-- Uses fixed UUIDs + ON CONFLICT DO NOTHING so re-running is safe.

INSERT INTO vectorbea.policy_packs (
  id, workspace_id, name, description, sector, system_pack, enabled, rules, created_at, updated_at
) VALUES

-- ── Retail ───────────────────────────────────────────────────────────────────
(
  'a1000000-0000-0000-0000-000000000001',
  NULL,
  'Retail Policy Pack',
  'Safe guardrails for retail AI agents handling refunds, promotions, and fulfilment.',
  'retail',
  true,
  true,
  '[
    {"name":"Refund eligibility required before createRefund","ruleType":"tool_sequence","severity":"critical","config":{"sequence":["checkRefundEligibility","createRefund"]}},
    {"name":"createRefund forbidden when eligibility false","ruleType":"tool_result_condition","severity":"critical","config":{"toolName":"checkRefundEligibility","field":"eligible","operator":"eq","value":false,"forbiddenNextTool":"createRefund"}},
    {"name":"Discount above threshold requires approval","ruleType":"human_handoff_required","severity":"high","config":{"condition":"discount_amount_exceeds_threshold"}},
    {"name":"Inventory check required before delivery promise","ruleType":"tool_required","severity":"high","config":{"toolName":"checkInventory"}}
  ]'::jsonb,
  now(), now()
),

-- ── BFSI ─────────────────────────────────────────────────────────────────────
(
  'a1000000-0000-0000-0000-000000000002',
  NULL,
  'BFSI Policy Pack',
  'Banking, financial services, and insurance compliance guardrails.',
  'bfsi',
  true,
  true,
  '[
    {"name":"PII must be masked in outputs","ruleType":"pii_detection","severity":"critical","config":{}},
    {"name":"High-risk transaction requires risk check","ruleType":"tool_required","severity":"critical","config":{"toolName":"runRiskCheck"}},
    {"name":"Loan decision requires eligibility evidence","ruleType":"tool_sequence","severity":"critical","config":{"sequence":["assessEligibility","approveLoan"]}},
    {"name":"Financial advice disclaimer required","ruleType":"output_contains","severity":"high","config":{"text":"not financial advice"}},
    {"name":"Human review required for high-value decisions","ruleType":"human_handoff_required","severity":"critical","config":{"condition":"transaction_value_high"}}
  ]'::jsonb,
  now(), now()
),

-- ── Healthcare ────────────────────────────────────────────────────────────────
(
  'a1000000-0000-0000-0000-000000000003',
  NULL,
  'Healthcare Policy Pack',
  'Patient safety guardrails for clinical AI assistants and triage workflows.',
  'healthcare',
  true,
  true,
  '[
    {"name":"Diagnosis as final action forbidden","ruleType":"final_action_condition","severity":"critical","config":{"forbiddenActions":["diagnose","confirm_diagnosis"]}},
    {"name":"Emergency symptoms require escalation","ruleType":"human_handoff_required","severity":"critical","config":{"condition":"emergency_symptoms_detected"}},
    {"name":"Medical advice must cite approved source","ruleType":"output_contains","severity":"high","config":{"text":"consult a healthcare professional"}},
    {"name":"Medication change advice forbidden","ruleType":"tool_forbidden","severity":"critical","config":{"toolName":"recommendMedicationChange"}},
    {"name":"Human review required for critical symptoms","ruleType":"human_handoff_required","severity":"critical","config":{"condition":"critical_symptom_flag"}}
  ]'::jsonb,
  now(), now()
),

-- ── Pharma ───────────────────────────────────────────────────────────────────
(
  'a1000000-0000-0000-0000-000000000004',
  NULL,
  'Pharma Policy Pack',
  'Pharmaceutical regulatory compliance for AI-assisted documentation and support.',
  'pharma',
  true,
  true,
  '[
    {"name":"Off-label claim forbidden","ruleType":"output_not_contains","severity":"critical","config":{"text":"off-label"}},
    {"name":"Approved label citation required","ruleType":"tool_required","severity":"high","config":{"toolName":"fetchApprovedLabel"}},
    {"name":"Adverse event mention requires escalation","ruleType":"human_handoff_required","severity":"critical","config":{"condition":"adverse_event_detected"}},
    {"name":"Medical claim must reference approved source","ruleType":"output_contains","severity":"high","config":{"text":"per approved prescribing information"}}
  ]'::jsonb,
  now(), now()
),

-- ── Software Support ──────────────────────────────────────────────────────────
(
  'a1000000-0000-0000-0000-000000000005',
  NULL,
  'Software Support Policy Pack',
  'Safe guardrails for AI coding assistants and technical support agents.',
  'software_support',
  true,
  true,
  '[
    {"name":"Secrets exposure forbidden","ruleType":"pii_detection","severity":"critical","config":{}},
    {"name":"Destructive command requires warning","ruleType":"output_contains","severity":"high","config":{"text":"warning"}},
    {"name":"Production action requires approval","ruleType":"human_handoff_required","severity":"critical","config":{"condition":"production_environment_action"}},
    {"name":"Credential request forbidden","ruleType":"tool_forbidden","severity":"critical","config":{"toolName":"requestCredentials"}},
    {"name":"Ticket category required before resolution","ruleType":"tool_required","severity":"medium","config":{"toolName":"categorizeTicket"}}
  ]'::jsonb,
  now(), now()
),

-- ── Travel ───────────────────────────────────────────────────────────────────
(
  'a1000000-0000-0000-0000-000000000006',
  NULL,
  'Travel Policy Pack',
  'Customer safety guardrails for travel booking and support AI agents.',
  'travel',
  true,
  true,
  '[
    {"name":"Booking change requires availability check","ruleType":"tool_sequence","severity":"high","config":{"sequence":["checkAvailability","modifyBooking"]}},
    {"name":"Refund or cancellation requires policy check","ruleType":"tool_required","severity":"high","config":{"toolName":"fetchCancellationPolicy"}},
    {"name":"Payment action requires confirmation","ruleType":"human_handoff_required","severity":"critical","config":{"condition":"payment_action"}},
    {"name":"Customer notification requires verified contact","ruleType":"tool_required","severity":"medium","config":{"toolName":"verifyContactDetails"}}
  ]'::jsonb,
  now(), now()
),

-- ── General AI Safety ─────────────────────────────────────────────────────────
(
  'a1000000-0000-0000-0000-000000000007',
  NULL,
  'General AI Safety Pack',
  'Baseline safety and compliance rules applicable to any production AI workflow.',
  'general',
  true,
  true,
  '[
    {"name":"PII exposure forbidden","ruleType":"pii_detection","severity":"critical","config":{}},
    {"name":"Unsafe action requires confirmation","ruleType":"human_handoff_required","severity":"high","config":{"condition":"unsafe_action_detected"}},
    {"name":"Human handoff for high-risk uncertainty","ruleType":"human_handoff_required","severity":"high","config":{"condition":"low_confidence_high_risk"}},
    {"name":"Tool arguments must be valid","ruleType":"argument_validation","severity":"medium","config":{}},
    {"name":"Cost threshold required for production workflows","ruleType":"cost_threshold","severity":"medium","config":{"max_cost":0.10}}
  ]'::jsonb,
  now(), now()
)

ON CONFLICT (id) DO NOTHING;
