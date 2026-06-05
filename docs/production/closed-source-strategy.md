# Vectorbea — Closed Source Strategy

## Status: Closed Source, Private Beta

Vectorbea is **not open source**. The core workflow engine, agent runtime, recovery engine, and AI Architect are proprietary.

## What This Means

- No public GitHub repository
- No public npm packages
- No public Maven/Gradle artifacts
- No public Docker images except those built by Railway/Render/Fly for deployment
- No vectorbea:proxy image published to Docker Hub
- No public SDK releasing during private beta
- No open-source license on core engine code

## Private Beta Model

- Invite-only access controlled by `PRIVATE_BETA_MODE=true`
- Admin manually reviews and approves every workspace
- Simulation mode enabled by default for safe evaluation
- Real execution requires admin approval + BYOK
- No self-signup, no public free tier

## Internal Packages

| Package | Status |
|---------|--------|
| `packages/recovery-kotlin` | Private, vendored into services |
| `packages/contracts` | Internal |
| `apps/api-kotlin` | Private deployment only |
| `apps/worker-kotlin` | Private deployment only |
| `apps/web` | Deployed to Vercel (no source published) |

## CI/CD Guardrails

CI will fail if:
- `npm publish` found in any workflow without `CI_ALLOW_PUBLIC_PUBLISH=true`
- `gradle publish` found in any workflow without explicit allowance
- `vectorbea:proxy` Docker push found in any workflow
- Stripe/Razorpay references found in production frontend code
- Frontend imports server-only modules

## Future Considerations

If Vectorbea moves to open-source in the future:
1. Remove `PRIVATE_BETA_MODE` enforcement
2. Move to public GitHub
3. Add open-source license
4. Publish SDK separately
5. This document gets updated or removed
