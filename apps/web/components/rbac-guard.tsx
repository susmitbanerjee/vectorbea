"use client";

import type { ReactNode } from "react";
import { useRBAC, type WorkspaceRole } from "@/lib/workspace-context";

/**
 * Conditionally renders children only if the current user satisfies the
 * required workspace role.  Use as a thin wrapper around any UI element
 * that should be hidden for lower-privileged users.
 *
 * ```tsx
 * <RbacGuard requiredRole="editor">
 *   <CreatePromptDialog />
 * </RbacGuard>
 * ```
 */
export function RbacGuard({
  requiredRole,
  children,
  fallback = null,
}: {
  requiredRole: WorkspaceRole;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasAccess } = useRBAC(requiredRole);
  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
