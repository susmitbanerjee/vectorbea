# Behavioral Evaluations

Behavioral Evaluations run non deterministic prompts against curated behavioral datasets with rubric based scoring.

## Current scope

- Single provider and single model execution per run
- One prompt version per run
- One behavioral dataset and one rubric per run
- Structured judge output with weighted dimension scoring
- Case level details and run level summary

## Run mode

- `rubric_scoring`
- `provider_arena`

This mode executes each dataset item through the selected provider and then scores output with the selected rubric.

`provider_arena` executes a dataset across multiple provider and model candidates and produces a production decision report with:

- provider leaderboard
- decision score and risk score
- rollout recommendation
- dimension level comparison
- cost and latency summaries
- case level output comparison

## What is stored

- `evaluation_runs` for run level status and aggregate summary
- `evaluation_executions` for per dataset item execution output and latency
- `judge_executions` for per item rubric judge result

## Pass and review behavior

Pass is true only when all are true:

- final score is at or above rubric pass threshold
- no critical hard failure is present
- judge execution succeeds

Needs review is raised for low confidence cases.

## Known limitation

- Pairwise arena battle matrix is not implemented yet
- Enterprise custom weighting policy is not yet configurable in UI
- Usage accounting currently maps arena matrix usage into evaluation run quota with TODO for dedicated provider and judge execution counters
