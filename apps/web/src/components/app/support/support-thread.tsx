"use client";

import * as React from "react";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { cn } from "~/lib/cn";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { Textarea } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { LocalTime } from "~/components/ui/local-time";

/* ══════════════════════════════════════════════════════════════════════════════
   SUPPORT CONVERSATION — shared by the widget (customer) and the portal (admin).

   `viewer` decides which side is "you": the customer's own messages sit on the
   right in the widget, support's in the portal. Status changes are a single
   centred line, not a bubble, so they do not read as somebody talking.
══════════════════════════════════════════════════════════════════════════════ */

export interface ThreadMessage {
  id: string;
  author_type: "customer" | "support" | "system";
  author_name: string | null;
  body: string;
  created_at: string;
}

export function SupportThread({
  messages,
  viewer,
  className,
}: {
  messages: ThreadMessage[];
  viewer: "customer" | "support";
  className?: string;
}) {
  if (messages.length === 0) return null;
  return (
    <ol className={cn("grid gap-2", className)}>
      {messages.map((m) => {
        if (m.author_type === "system") {
          return (
            <li key={m.id} className="py-1 text-center">
              <Text variant="caption" tone="muted">
                {m.body} <LocalTime at={m.created_at} format="short" />
              </Text>
            </li>
          );
        }
        const own = m.author_type === viewer;
        return (
          <li key={m.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-md border px-3 py-2",
                own ? "bg-accent-subtle border-accent-border" : "bg-surface-raised border-subtle",
              )}
            >
              <Text variant="caption" tone="muted" className="block">
                {/* Support has many authors (portal, technicians), so only the customer sees "You". */}
                {own && viewer === "customer" ? "You" : m.author_name ?? (m.author_type === "support" ? "Support" : "Customer")}
                {" · "}
                <LocalTime at={m.created_at} format="short" />
              </Text>
              <Text variant="body-sm" tone="primary" className="mt-0.5 block whitespace-pre-wrap break-words">
                {m.body}
              </Text>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A reply box. `onSend` resolves to an error message, or null when it was sent. */
export function ReplyBox({
  label,
  placeholder,
  sendLabel = "Send",
  onSend,
}: {
  label: string;
  placeholder?: string;
  sendLabel?: string;
  onSend: (body: string) => Promise<string | null>;
}) {
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function send() {
    const text = body.trim();
    if (text.length < 2) return setError("Write a message first.");
    setSending(true);
    setError(null);
    const problem = await onSend(text);
    setSending(false);
    if (problem) setError(problem);
    else setBody("");
  }

  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <Textarea
        aria-label={label}
        value={body}
        maxLength={10000}
        minRows={2}
        maxRows={8}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
        }}
      />
      {error ? (
        <Text variant="body-sm" tone="inherit" role="alert" className="text-status-failed block">{error}</Text>
      ) : null}
      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={sending}
          loadingLabel="Sending"
          disabled={body.trim().length < 2}
          iconLeft={<Icon icon={PaperPlaneTilt} size="sm" decorative />}
        >
          {sendLabel}
        </Button>
      </div>
    </form>
  );
}
