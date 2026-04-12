"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import type {
  OrganizationView,
  OrganizationWorkspaceView,
  PlanTier,
  WorkspaceRole,
} from "@/lib/api";

export type { WorkspaceRole } from "@/lib/api";

const ROLE_ORDINAL: Record<WorkspaceRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

const DEFAULT_ROLE: WorkspaceRole = "viewer";
const ACTIVE_WORKSPACE_STORAGE_KEY = "vectorbea.activeWorkspaceId";

export interface WorkspaceView {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  role: WorkspaceRole;
}

interface WorkspaceContextValue {
  organizations: OrganizationView[];
  workspaces: WorkspaceView[];
  activeOrganization: OrganizationView | null;
  activeWorkspace: WorkspaceView | null;
  activeWorkspaceId: string | null;
  role: WorkspaceRole;
  planTier: PlanTier;
  seatUsage: {
    used: number;
    max: number;
    remaining: number;
    atLimit: boolean;
    hasConfiguredLimit: boolean;
  };
  canCreateOrganization: boolean;
  setActiveWorkspaceId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function normalizeWorkspaceRole(role?: string | null): WorkspaceRole {
  if (role === "viewer" || role === "editor" || role === "admin") {
    return role;
  }
  return DEFAULT_ROLE;
}

function mapWorkspace(
  organization: OrganizationView,
  workspace?: OrganizationWorkspaceView,
): WorkspaceView {
  return {
    id: workspace?.id ?? organization.id,
    name: workspace?.name ?? organization.name,
    organizationId: workspace?.organizationId ?? organization.id,
    organizationName: workspace?.organizationName ?? organization.name,
    role: normalizeWorkspaceRole(
      workspace?.role ?? organization.workspaceRole ?? organization.role,
    ),
  };
}

function deriveWorkspaces(organizations: OrganizationView[]): WorkspaceView[] {
  return organizations.flatMap((organization) => {
    if (organization.workspaces?.length) {
      return organization.workspaces.map((workspace) =>
        mapWorkspace(organization, workspace),
      );
    }
    return [mapWorkspace(organization)];
  });
}

function normalizePlanTier(planTier?: PlanTier | null): PlanTier {
  if (planTier === "pro" || planTier === "enterprise") {
    return planTier;
  }
  return "free";
}

export function WorkspaceProvider({
  organizations,
  children,
}: {
  organizations: OrganizationView[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const workspaces = useMemo(() => deriveWorkspaces(organizations), [organizations]);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(
    () => searchParams.get("org"),
  );

  useEffect(() => {
    const queryWorkspaceId = searchParams.get("org");
    if (queryWorkspaceId && queryWorkspaceId !== activeWorkspaceId) {
      setActiveWorkspaceIdState(queryWorkspaceId);
    }
  }, [activeWorkspaceId, searchParams]);

  useEffect(() => {
    if (workspaces.length === 0) {
      if (activeWorkspaceId !== null) {
        setActiveWorkspaceIdState(null);
      }
      return;
    }

    const availableIds = new Set(workspaces.map((workspace) => workspace.id));
    let nextActiveId = activeWorkspaceId;

    if (!nextActiveId || !availableIds.has(nextActiveId)) {
      const queryWorkspaceId = searchParams.get("org");
      if (queryWorkspaceId && availableIds.has(queryWorkspaceId)) {
        nextActiveId = queryWorkspaceId;
      }
    }

    if ((!nextActiveId || !availableIds.has(nextActiveId)) && typeof window !== "undefined") {
      const storedWorkspaceId = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
      if (storedWorkspaceId && availableIds.has(storedWorkspaceId)) {
        nextActiveId = storedWorkspaceId;
      }
    }

    if (!nextActiveId || !availableIds.has(nextActiveId)) {
      nextActiveId = workspaces[0]?.id ?? null;
    }

    if (nextActiveId !== activeWorkspaceId) {
      setActiveWorkspaceIdState(nextActiveId);
    }
  }, [activeWorkspaceId, searchParams, workspaces]);

  useEffect(() => {
    if (!activeWorkspaceId) return;

    window.localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, activeWorkspaceId);

    const params = new URLSearchParams(searchParams.toString());
    if (params.get("org") === activeWorkspaceId) {
      return;
    }

    params.set("org", activeWorkspaceId);
    const nextUrl = `${pathname}${params.toString() ? `?${params}` : ""}`;
    router.replace(nextUrl as Route);
  }, [activeWorkspaceId, pathname, router, searchParams]);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaces[0] ??
    null;
  const activeOrganization =
    organizations.find((organization) => organization.id === activeWorkspace?.organizationId) ??
    organizations[0] ??
    null;
  const role = activeWorkspace?.role ?? DEFAULT_ROLE;
  const planTier = normalizePlanTier(activeOrganization?.planTier);
  const hasConfiguredLimit =
    activeOrganization?.maxSeats != null || activeOrganization?.currentUsers != null;
  const maxSeats = Math.max(
    activeOrganization?.maxSeats ?? activeOrganization?.currentUsers ?? 1,
    1,
  );
  const seatsUsed = Math.max(activeOrganization?.currentUsers ?? 0, 0);
  const seatUsage = useMemo(
    () => ({
      used: seatsUsed,
      max: maxSeats,
      remaining: Math.max(maxSeats - seatsUsed, 0),
      atLimit: hasConfiguredLimit ? seatsUsed >= maxSeats : false,
      hasConfiguredLimit,
    }),
    [hasConfiguredLimit, maxSeats, seatsUsed],
  );
  const canCreateOrganization = !(planTier === "free" && organizations.length >= 1);

  const setActiveWorkspaceId = useCallback(
    (id: string) => {
      if (!workspaces.some((workspace) => workspace.id === id)) {
        return;
      }
      setActiveWorkspaceIdState(id);
    },
    [workspaces],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      organizations,
      workspaces,
      activeOrganization,
      activeWorkspace,
      activeWorkspaceId: activeWorkspace?.id ?? activeWorkspaceId ?? null,
      role,
      planTier,
      seatUsage,
      canCreateOrganization,
      setActiveWorkspaceId,
    }),
    [
      organizations,
      workspaces,
      activeOrganization,
      activeWorkspace,
      activeWorkspaceId,
      role,
      planTier,
      seatUsage,
      canCreateOrganization,
      setActiveWorkspaceId,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within <WorkspaceProvider>");
  }
  return ctx;
}

export function useRBAC(requiredRole?: WorkspaceRole) {
  const { role } = useWorkspace();

  const hasAccess = requiredRole
    ? ROLE_ORDINAL[role] >= ROLE_ORDINAL[requiredRole]
    : true;

  return {
    role,
    hasAccess,
    isAdmin: role === "admin",
    isEditor: ROLE_ORDINAL[role] >= ROLE_ORDINAL.editor,
    isViewer: true,
  };
}
