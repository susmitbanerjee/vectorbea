import "server-only";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export async function writeAuditEvent(args: {
  workspaceId: string;
  actorUserId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  entityName?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase.from("audit_events").insert({
    workspace_id: args.workspaceId,
    actor_user_id: args.actorUserId ?? null,
    event_type: args.eventType,
    entity_type: args.entityType,
    entity_id: args.entityId,
    entity_name: args.entityName ?? null,
    metadata: args.metadata ?? {},
    ip_address: args.ipAddress ?? null,
    user_agent: args.userAgent ?? null,
  });
  if (error && !error.message.toLowerCase().includes("does not exist")) {
    console.error("[audit] failed to write audit event:", error.message);
  }
}
