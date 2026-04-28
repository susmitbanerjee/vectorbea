# Notifications Email System

## Summary
VectorBea notification emails now use a shared warm light enterprise theme that matches the product UI

The email system is preference aware and recipient aware before delivery

## Delivery flow
1. Runtime event creates a notification event
2. Workspace recipients are resolved from `workspace_members`
3. Workspace notification preferences are loaded
4. User notification preferences are loaded per recipient
5. Event category severity and filters are evaluated
6. Email is rendered from shared themed templates
7. Delivery result is recorded in `vectorbea.notification_deliveries` when table exists

## Preference behavior
- Workspace channel gating is enforced first
- User level email opt out is respected
- Event category toggles are respected
- Severity threshold is respected when configured
- Environment and prompt filters are respected when configured
- Quota emails are limited to owner and admin roles

## Security rules
- No provider keys are included in email content
- No raw prompt or output dumps are sent by default
- Emails contain metadata and secure links back to VectorBea

## New schema
Migration `2026-04-28-notification-preferences-and-deliveries.sql` adds
- `vectorbea.workspace_notification_prefs`
- `vectorbea.user_notification_prefs`
- `vectorbea.notification_deliveries`

## Current known limitations
- User reviewer identity is still user id based
- Scoring policy remains server side code configured
- Direct provider replay remains simulated where no live provider executor exists
- Scheduler triggering still depends on configured runtime jobs where applicable

