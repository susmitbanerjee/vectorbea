import { describe, expect, it } from "vitest";

import { contracts } from "@vectorbea/shared";
import { can, denialReason, requiredRole, roleLabel } from "~/lib/auth/permissions";
import { hasWorkspaceRole, type WorkspaceRole } from "@/lib/server/assert-workspace-member";

/**
 * The role reconciliation.
 *
 * The defect: the TypeScript union was `"viewer" | "editor" | "admin"` while the
 * database CHECK constraint is `role IN ('owner','admin','developer','viewer')`.
 * They agreed on two of four values, and the disagreement was silent —
 * `normalizeRole` returned `"viewer"` for anything it did not recognise.
 *
 * Since `lib/auth/oauth-upsert.ts` inserts every OAuth sign-up as `owner`, the
 * practical effect was that **every workspace owner was authorised as a
 * viewer**. "Your role: Viewer" beside a row saying Owner was the visible half;
 * the other half was `hasWorkspaceRole(role, "admin")` returning false for the
 * person who created the workspace.
 */

const DB_ROLES = ["owner", "admin", "developer", "viewer"] as const;

describe("workspace role reconciliation", () => {
  it("recognises every role the database permits", () => {
    // The regression guard. If someone re-narrows the union, this fails.
    for (const role of DB_ROLES) {
      expect(contracts.normalizeWorkspaceRole(role)).toBe(role);
    }
  });

  it("no longer demotes an owner to viewer", () => {
    expect(contracts.normalizeWorkspaceRole("owner")).toBe("owner");
    expect(contracts.normalizeWorkspaceRole("owner")).not.toBe("viewer");
  });

  it("no longer demotes a developer to viewer", () => {
    expect(contracts.normalizeWorkspaceRole("developer")).toBe("developer");
  });

  it("maps the legacy `editor` alias to developer, not to viewer", () => {
    // `editor` was in the old union but is NOT a valid database value, so
    // invitation rows carrying it must not silently lose their privileges.
    expect(contracts.normalizeWorkspaceRole("editor")).toBe("developer");
  });

  it("still falls back to least privilege for anything unknown", () => {
    expect(contracts.normalizeWorkspaceRole("superuser")).toBe("viewer");
    expect(contracts.normalizeWorkspaceRole(null)).toBe("viewer");
    expect(contracts.normalizeWorkspaceRole(undefined)).toBe("viewer");
    expect(contracts.normalizeWorkspaceRole(42)).toBe("viewer");
  });

  it("orders roles so an owner outranks an admin", () => {
    expect(contracts.roleAtLeast("owner", "admin")).toBe(true);
    expect(contracts.roleAtLeast("admin", "owner")).toBe(false);
    expect(contracts.roleAtLeast("developer", "viewer")).toBe(true);
    expect(contracts.roleAtLeast("viewer", "developer")).toBe(false);
  });
});

describe("server guard (assert-workspace-member)", () => {
  it("grants an owner every level, including admin", () => {
    // The authorization half of the bug: this returned false before the fix,
    // so an owner was refused admin-gated routes like creating a policy pack.
    const owner = "owner" as WorkspaceRole;
    expect(hasWorkspaceRole(owner, "admin")).toBe(true);
    expect(hasWorkspaceRole(owner, "developer")).toBe(true);
    expect(hasWorkspaceRole(owner, "viewer")).toBe(true);
  });

  it("keeps a viewer out of everything above viewer", () => {
    const viewer = "viewer" as WorkspaceRole;
    expect(hasWorkspaceRole(viewer, "viewer")).toBe(true);
    expect(hasWorkspaceRole(viewer, "developer")).toBe(false);
    expect(hasWorkspaceRole(viewer, "admin")).toBe(false);
  });
});

describe("capability matrix", () => {
  it("lets an owner do the owner-only things", () => {
    expect(can("owner", "workspace.danger")).toBe(true);
    expect(can("owner", "connection.rotate")).toBe(true);
  });

  it("stops an admin short of the owner-only things", () => {
    // Rotating a credential breaks everything holding the old one, and
    // resetting a workspace is unrecoverable. Both sit above admin.
    expect(can("admin", "workspace.danger")).toBe(false);
    expect(can("admin", "connection.rotate")).toBe(false);
    expect(can("admin", "member.manage")).toBe(true);
  });

  it("lets a developer edit but not publish", () => {
    expect(can("developer", "workflow.edit")).toBe(true);
    expect(can("developer", "workflow.publish")).toBe(false);
  });

  it("lets a viewer read and nothing else", () => {
    expect(can("viewer", "workflow.view")).toBe(true);
    expect(can("viewer", "run.view")).toBe(true);
    expect(can("viewer", "workflow.edit")).toBe(false);
    expect(can("viewer", "run.trigger")).toBe(false);
  });

  it("explains a denial by naming both roles", () => {
    const reason = denialReason("developer", "workflow.publish");
    expect(reason).toContain("Developer");
    expect(reason).toContain("Admin");
    // Null when permitted, so it doubles as a disabled-reason.
    expect(denialReason("owner", "workflow.publish")).toBeNull();
  });

  it("exposes the required role for copy", () => {
    expect(requiredRole("workspace.danger")).toBe("owner");
    expect(roleLabel("developer")).toBe("Developer");
  });
});

describe("/api/me contract", () => {
  it("normalises a legacy role on parse rather than rejecting it", () => {
    const parsed = contracts.me.parse({
      user: {
        id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        supabaseUserId: "gh|1",
        email: "a@b.test",
      },
      workspaces: [
        { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", name: "Acme", slug: "acme", role: "owner" },
        { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", name: "Old", slug: "old", role: "editor" },
      ],
      defaultWorkspaceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    });

    expect(parsed.workspaces[0].role).toBe("owner");
    expect(parsed.workspaces[1].role).toBe("developer");
  });
});
