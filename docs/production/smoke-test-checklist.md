# Vectorbea Production Smoke Test Checklist

Run through all steps after every production deployment.

---

## Infrastructure

- [ ] **1.** `GET /health` returns `{"status":"ok"}`
- [ ] **2.** `GET /ready` returns `{"db":"ok","redis":"ok"}`

## Beta Access

- [ ] **3.** Unauthenticated request to `GET /api/workflows` returns 401
- [ ] **4.** Authenticated but unapproved user gets 403 PRIVATE_BETA_ACCESS_REQUIRED on `GET /api/workflows`
- [ ] **5.** Unapproved user CAN access `GET /api/beta/status` and `POST /api/beta/apply`
- [ ] **6.** Submitting beta application returns 201 with status=waitlisted

## Admin Approval

- [ ] **7.** `GET /api/admin/beta/applications` returns 403 for non-admin
- [ ] **8.** `GET /api/admin/beta/applications` returns 200 for admin email
- [ ] **9.** `POST /api/admin/beta/applications/{id}/approve` sets beta_status=approved
- [ ] **10.** Approved user can now access `GET /api/workflows`

## Workspace + Simulation

- [ ] **11.** Approved user sees their workspace
- [ ] **12.** `POST /api/workflows/{id}/run` with `"mode":"simulation"` returns 201 queued
- [ ] **13.** `GET /api/runs/{id}` shows run with execution_mode=simulation
- [ ] **14.** Simulation run does NOT call external APIs (check logs: no HTTP calls to external tools)

## Real Execution Gating

- [ ] **15.** `POST /api/workflows/{id}/run` with `"mode":"real"` returns 403 REAL_EXECUTION_NOT_ENABLED (before admin enables)
- [ ] **16.** `POST /api/admin/beta/workspaces/{wsId}/enable-real-execution` succeeds for admin
- [ ] **17.** After enabling: user creates BYOK LLM connection (OpenAI/Anthropic)
- [ ] **18.** Connection test passes
- [ ] **19.** Real run queues Redis job: check Upstash dashboard for message in workflow-runs stream

## Worker

- [ ] **20.** Worker consumes the Redis job (check worker logs)
- [ ] **21.** Run events appear in Postgres: `SELECT * FROM run_events WHERE run_id='...' LIMIT 10`
- [ ] **22.** SSE events stream to frontend (run detail page shows live updates)

## Usage Limits

- [ ] **23.** `GET /api/beta/status` shows maxRunsPerDay and maxWorkflows
- [ ] **24.** After 20 runs in a day, 21st run returns 429 BETA_USAGE_LIMIT_EXCEEDED

## Admin Disable

- [ ] **25.** `POST /api/admin/beta/workspaces/{wsId}/disable` with reason immediately blocks workspace
- [ ] **26.** Disabled workspace user gets 403 WORKSPACE_DISABLED on `GET /api/workflows`

## Security

- [ ] **27.** Check API logs: no secret values (API keys, DB URLs, tokens) appear
- [ ] **28.** Check run events in DB: no secret values in payload columns
- [ ] **29.** Cross-workspace access: User A token cannot GET User B's workflow by ID
- [ ] **30.** Invalid JWT returns 401 Unauthorized

---

**Smoke test PASS threshold:** All 30 checks must pass before declaring production ready.

Last verified: ___________  
Verified by: ___________
