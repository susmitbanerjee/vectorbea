# Slack Integration

VectorBea supports Slack webhook notifications at the workspace level.

## Setup (via Settings UI)

1. Go to **Settings → Integrations → Slack**
2. Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) in your Slack workspace
3. Paste the webhook URL (`https://hooks.slack.com/services/...`)
4. Click **Test notification** to verify
5. Toggle which events should post to Slack
6. Save


## API

```
GET  /api/settings/integrations/slack?workspaceId=<id>    # Returns config (webhook masked)
PUT  /api/settings/integrations/slack?workspaceId=<id>    # Update webhook/events/enabled
POST /api/settings/integrations/slack/test?workspaceId=<id>  # Send test message
```

PUT body:
```json
{
  "webhookUrl": "https://hooks.slack.com/services/...",
  "enabled": true,
  "events": {
    "alerts": true,
    "regressions": true,
    "evaluations": false,
    "rollout": true,
    "quota": false
  }
}
```

## Events

| Event | Key | Default |
|---|---|---|
| Alert triggered | `alerts` | ✅ |
| Regression failed | `regressions` | ✅ |
| Evaluation completed/failed | `evaluations` | ❌ |
| Rollout blocked / promoted | `rollout` | ✅ |
| Quota warning | `quota` | ❌ |

## Security

- The webhook URL is encrypted with AES-GCM before storage in `vectorbea.workspace_integrations`
- The raw URL is never returned by the API — only a masked placeholder
- The raw URL is never logged
- Set `INTEGRATION_ENCRYPTION_KEY` (32-char string) for production encryption; falls back to app secret in dev

## Required Environment Variables

```env
INTEGRATION_ENCRYPTION_KEY=<32-character-string>
APP_URL=https://your-app.example.com
```
