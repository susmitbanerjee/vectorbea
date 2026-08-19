import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "~/lib/api/keys";

/**
 * Cross-environment cache isolation.
 *
 * The failure this guards against is the worst one in the product: staging
 * numbers rendered under a production heading, or the reverse. It happens when
 * a cache key does not carry the scope, so two environments share an entry and
 * whoever fetched last wins.
 *
 * The design that prevents it is workspace and environment at the FRONT of
 * every key. These tests assert both halves of that: entries cannot collide,
 * and one prefix invalidation reaches everything below it.
 */

const wsA = "ws-a";
const wsB = "ws-b";
const prod = "production";
const staging = "staging";

describe("query key scoping", () => {
  it("gives two environments different keys for the same query", () => {
    const a = JSON.stringify(queryKeys.runs.list({ workspaceId: wsA, environmentId: prod }));
    const b = JSON.stringify(queryKeys.runs.list({ workspaceId: wsA, environmentId: staging }));
    expect(a).not.toBe(b);
  });

  it("gives two workspaces different keys for the same environment name", () => {
    const a = JSON.stringify(queryKeys.runs.list({ workspaceId: wsA, environmentId: prod }));
    const b = JSON.stringify(queryKeys.runs.list({ workspaceId: wsB, environmentId: prod }));
    expect(a).not.toBe(b);
  });

  it("puts scope before the entity, so a prefix match reaches everything", () => {
    const key = queryKeys.runs.list({ workspaceId: wsA, environmentId: prod });
    expect(key.slice(0, 4)).toEqual(["ws", wsA, "env", prod]);
  });

  it("distinguishes filter sets within one scope", () => {
    const scope = { workspaceId: wsA, environmentId: prod };
    const failed = JSON.stringify(queryKeys.runs.list(scope, { status: "failed" }));
    const all = JSON.stringify(queryKeys.runs.list(scope, {}));
    expect(failed).not.toBe(all);
  });
});

describe("scope switching", () => {
  it("does not serve one environment's data for another", () => {
    const client = new QueryClient();
    const scopeProd = { workspaceId: wsA, environmentId: prod };
    const scopeStaging = { workspaceId: wsA, environmentId: staging };

    client.setQueryData(queryKeys.runs.list(scopeProd), { items: ["prod-run"], total: 1 });

    // The staging key must be a miss, not a hit on production's entry.
    expect(client.getQueryData(queryKeys.runs.list(scopeStaging))).toBeUndefined();
    expect(client.getQueryData(queryKeys.runs.list(scopeProd))).toEqual({
      items: ["prod-run"],
      total: 1,
    });
  });

  it("removes every entity below a scope in one call", () => {
    const client = new QueryClient();
    const scope = { workspaceId: wsA, environmentId: prod };

    client.setQueryData(queryKeys.runs.list(scope), { items: [] });
    client.setQueryData(queryKeys.workflows.list(scope), { items: [] });
    client.setQueryData(queryKeys.agents.list(scope), { items: [] });
    client.setQueryData(queryKeys.dashboard.summary(scope), { runs24h: 1 });

    // What the environment switcher does when leaving a scope.
    client.removeQueries({ queryKey: queryKeys.env(wsA, prod) });

    expect(client.getQueryData(queryKeys.runs.list(scope))).toBeUndefined();
    expect(client.getQueryData(queryKeys.workflows.list(scope))).toBeUndefined();
    expect(client.getQueryData(queryKeys.agents.list(scope))).toBeUndefined();
    expect(client.getQueryData(queryKeys.dashboard.summary(scope))).toBeUndefined();
  });

  it("leaves other scopes untouched when one is dropped", () => {
    const client = new QueryClient();
    const scopeProd = { workspaceId: wsA, environmentId: prod };
    const scopeStaging = { workspaceId: wsA, environmentId: staging };
    const otherWorkspace = { workspaceId: wsB, environmentId: prod };

    client.setQueryData(queryKeys.runs.list(scopeProd), { items: ["p"] });
    client.setQueryData(queryKeys.runs.list(scopeStaging), { items: ["s"] });
    client.setQueryData(queryKeys.runs.list(otherWorkspace), { items: ["b"] });

    client.removeQueries({ queryKey: queryKeys.env(wsA, prod) });

    // Dropping production must not evict staging or another workspace —
    // otherwise rapid switching becomes a refetch storm.
    expect(client.getQueryData(queryKeys.runs.list(scopeStaging))).toEqual({ items: ["s"] });
    expect(client.getQueryData(queryKeys.runs.list(otherWorkspace))).toEqual({ items: ["b"] });
  });

  it("survives rapid switching without leaking between scopes", () => {
    const client = new QueryClient();
    const scopes = [
      { workspaceId: wsA, environmentId: prod },
      { workspaceId: wsA, environmentId: staging },
      { workspaceId: wsB, environmentId: prod },
    ];

    // Fill, drop, refill — the pattern of someone flipping the switcher.
    for (let round = 0; round < 5; round += 1) {
      for (const [index, scope] of scopes.entries()) {
        client.setQueryData(queryKeys.runs.list(scope), { items: [`r${round}-s${index}`] });
      }
      for (const scope of scopes) {
        client.removeQueries({ queryKey: queryKeys.env(scope.workspaceId, scope.environmentId) });
      }
    }

    for (const scope of scopes) {
      expect(client.getQueryData(queryKeys.runs.list(scope))).toBeUndefined();
    }
  });

  it("keeps identity out of workspace scope so it survives a switch", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.me(), { user: { id: "u1" } });

    client.removeQueries({ queryKey: queryKeys.env(wsA, prod) });

    // /api/me is not workspace-scoped; re-fetching it on every switch would
    // put a request in front of every environment change for no reason.
    expect(client.getQueryData(queryKeys.me())).toEqual({ user: { id: "u1" } });
  });

  it("clears everything on sign-out", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.me(), { user: { id: "u1" } });
    client.setQueryData(queryKeys.runs.list({ workspaceId: wsA, environmentId: prod }), { items: [] });

    client.clear();

    expect(client.getQueryData(queryKeys.me())).toBeUndefined();
    expect(
      client.getQueryData(queryKeys.runs.list({ workspaceId: wsA, environmentId: prod })),
    ).toBeUndefined();
  });
});
