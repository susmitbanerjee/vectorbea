# Email Notification Setup

VectorBea supports three email providers. Configure via environment variables.

## Provider Selection

```env
EMAIL_PROVIDER=smtp        # smtp (default) | resend | sendgrid
FROM_EMAIL=noreply@yourdomain.com
APP_URL=https://your-app.example.com
```

---

## Resend (Recommended)

```env
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxx
FROM_EMAIL=noreply@yourdomain.com
```

Sign up at https://resend.com. Verify your domain for production use.

---

## SendGrid

```env
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxx
FROM_EMAIL=noreply@yourdomain.com
```

---

## SMTP

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_SECURE=starttls   # tls | starttls
FROM_EMAIL=noreply@yourdomain.com
```

Requires `nodemailer` to be installed:
```bash
npm install nodemailer
npm install -D @types/nodemailer
```

---

## Email Types

| Trigger | Template | Sent to |
|---|---|---|
| Team invitation sent | `teamInvitationEmail` | Invited email |
| Evaluation completed | `evaluationCompletedEmail` | Workspace admins |
| Evaluation failed | `evaluationFailedEmail` | Workspace admins |
| Regression schedule failed | `regressionFailedEmail` | Workspace admins |
| Alert triggered | `alertTriggeredEmail` | Workspace admins |
| Rollout blocked | `rolloutBlockedEmail` | Workspace admins |
| Quota >80% | `quotaWarningEmail` | Workspace admins |

---

## Notification Preferences

Emails are gated by workspace preferences stored in `vectorbea.workspace_notification_prefs`.

- `email_enabled`: master switch
- `events`: per-event toggles (`alerts`, `regressions`, `evaluations`, `rollout`, `quota`)

Manage via:
```
GET  /api/workspaces/:id/notification-preferences
PUT  /api/workspaces/:id/notification-preferences
```

---

## Security Notes

- No email credentials are logged
- Invitation tokens are stored as SHA-256 hashes — the raw token is never stored
- Send errors are logged at `warn` level but never break the main flow
- Retries: up to 2 retries with 500ms / 1000ms backoff
