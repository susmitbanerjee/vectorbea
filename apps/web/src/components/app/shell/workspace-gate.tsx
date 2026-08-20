"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { PageContainer } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { useWorkspace } from "~/lib/workspace/workspace-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   THE WORKSPACE GATE

   Every scoped query in the app is `enabled: Boolean(workspaceId)`. When there
   is no workspace they do not fail — they never run, and `isPending` stays true
   forever. Each screen then renders its own skeleton indefinitely, which is the
   worst of the three degradation outcomes: it says "loading" about something
   that is never going to load, and it says it in twenty places at once.

   So the shell answers the question ONCE, above the routes, in the states that
   actually exist:

     resolving        · a real, bounded wait — the membership list is in flight
     unauthenticated  · sign in
     no-memberships   · a real account state, not an error: ask for an invite
     offline          · the request was never sent; reconnect
     unreachable      · the API did not answer; retry is meaningful

   The failure states are deliberately different screens because they take
   different actions. Collapsing them into one "something went wrong" is how a
   user who needs an invitation ends up retrying a button forever, and how
   somebody offline is told their account is broken.
══════════════════════════════════════════════════════════════════════════════ */

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const { resolving, problem, retry } = useWorkspace();

  if (resolving) return <Resolving />;
  if (!problem) return <>{children}</>;

  if (problem === "unauthenticated") {
    return (
      <Panel
        title="Your session has ended"
        body="Sign in again to pick up where you left off. Nothing has been lost — this is only about who the API thinks is asking."
      >
        <Button asChild variant="primary" size="sm">
          <Link href={"/signin" as Route}>Sign in</Link>
        </Button>
      </Panel>
    );
  }

  if (problem === "no-memberships") {
    return (
      <Panel
        title="Your account is not in a workspace yet"
        body="You are signed in, but this account does not belong to any workspace, so there is nothing to show. Ask an owner to invite you — or create one, and you will be its owner."
      >
        <Button asChild variant="primary" size="sm">
          <Link href={"/onboarding" as Route}>Create a workspace</Link>
        </Button>
        <Button variant="secondary" size="sm" onClick={retry}>
          I have been invited — check again
        </Button>
      </Panel>
    );
  }

  if (problem === "offline") {
    return (
      <Panel
        title="You appear to be offline"
        body="The browser reports no network connection, so the request for your workspaces was never sent. Nothing is wrong with your account or the workspace — reconnect and try again."
      >
        <Button variant="primary" size="sm" onClick={retry}>Try again</Button>
      </Panel>
    );
  }

  return (
    <Panel
      title="Could not read your workspaces"
      body="The API did not answer when asked which workspaces this account belongs to, so nothing can be scoped yet. Every workflow and schedule is still running — this is a read failure, not an outage."
    >
      <Button variant="primary" size="sm" onClick={retry}>Try again</Button>
    </Panel>
  );
}

/**
 * The bounded wait.
 *
 * A spinner is only honest when something is genuinely in flight and will
 * settle, which is exactly this case and none of the others below it.
 */
function Resolving() {
  return (
    <PageContainer>
      <div className="grid place-items-center px-4 py-24">
        <span className="flex items-center gap-2.5">
          <Spinner className="size-4" />
          <Text variant="body-sm" tone="secondary">Finding your workspaces…</Text>
        </span>
      </div>
    </PageContainer>
  );
}

function Panel({
  title, body, children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <PageContainer>
      <div className="border-subtle bg-surface-raised mt-6 grid place-items-center rounded-lg border px-4 py-16">
        <div className="max-w-[42rem] text-center">
          <Text variant="heading-sm" tone="max" as="h1" className="block">{title}</Text>
          <Text variant="body-sm" tone="secondary" className="mx-auto mt-2 block max-w-[52ch]">
            {body}
          </Text>
          <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>
        </div>
      </div>
    </PageContainer>
  );
}
