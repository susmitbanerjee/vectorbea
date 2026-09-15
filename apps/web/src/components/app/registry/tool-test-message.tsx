"use client";

import * as React from "react";
import { PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";

import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input, Textarea } from "~/components/ui/input";
import { ModalNote, ModalSection } from "~/components/ui/modal";
import { useApi } from "~/lib/api/api-provider";
import { useScope } from "~/lib/workspace/workspace-provider";
import type { TestMessageResult } from "~/lib/api/client";
import type { OperationParam, ProviderOperation } from "~/content/integrations";

/* ══════════════════════════════════════════════════════════════════════════════
   SEND A TEST MESSAGE

   Validate says the configuration is well-formed. For a message tool that is
   the least useful thing to know: what goes wrong is that the bot was never
   invited to the channel, the channel ID was copied from the wrong place, or the
   webhook was deleted — and the provider only says so when something is posted.
   So this posts one real message, and says in the button that it will.

   The values the tool fixes (the channel) are sent as fixed; anything left to
   each run is asked for here, because a test needs a real channel to land in.
══════════════════════════════════════════════════════════════════════════════ */

export interface ToolTestMessageProps {
  connectionId: string | null;
  operation: ProviderOperation;
  /** Values fixed on the tool, by parameter name. */
  fixedValues: Record<string, string>;
  bindingOf: (param: OperationParam) => "config" | "input";
  toolName: string;
  appLabel: string;
}

export function ToolTestMessage({
  connectionId, operation, fixedValues, bindingOf, toolName, appLabel,
}: ToolTestMessageProps) {
  const api = useApi();
  const scope = useScope();

  const messageParam = operation.params.find((param) => param.type === "text") ?? null;
  /* Required per-run values other than the message — for Slack, the channel when
     the tool lets each run choose it. Optional ones (reply in thread) are not
     asked: a test does not need them. */
  const askFor = operation.params.filter((param) =>
    param !== messageParam && param.required && bindingOf(param) === "input");

  const [text, setText] = React.useState(
    `Test message from Vectorbea: "${toolName.trim() || operation.label}" is set up and can post here.`,
  );
  const [extra, setExtra] = React.useState<Record<string, string>>({});
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<TestMessageResult | null>(null);

  /* A result is about the settings it was sent with. */
  const settingsKey = JSON.stringify({ connectionId, id: operation.id, fixedValues });
  React.useEffect(() => { setResult(null); }, [settingsKey]);

  const missing = askFor.find((param) => !extra[param.name]?.trim()) ?? null;

  async function send() {
    if (!connectionId || !messageParam) return;
    setSending(true);
    setResult(null);
    try {
      const outcome = await api.tools.testMessage(
        {
          connectionId,
          operationId: operation.id,
          parameters: { ...fixedValues, ...extra, [messageParam.name]: text },
        },
        { workspaceId: scope.workspaceId, environmentId: null },
      );
      setResult(outcome);
    } catch (error) {
      setResult({
        delivered: false,
        errorCode: null,
        latencyMs: 0,
        message: error instanceof Error ? error.message : "The test message could not be sent. Try again.",
      });
    } finally {
      setSending(false);
    }
  }

  if (!messageParam) return null;

  return (
    <ModalSection
      title="Send a test message"
      description={`Posts one real message to ${appLabel} so you can see it arrive before a workflow depends on it.`}
    >
      <div className="grid gap-3">
        {askFor.map((param) => (
          <Field
            key={param.name}
            label={`${param.label} for the test`}
            description="This tool lets each run choose, so pick one for the test."
          >
            <Input
              value={extra[param.name] ?? ""}
              onChange={(event) => setExtra((current) => ({ ...current, [param.name]: event.target.value }))}
              placeholder={param.placeholder}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        ))}

        <Field label="Message" characterCount={{ value: text.length, max: 2000 }}>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            minRows={2}
            maxRows={5}
            maxLength={2000}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            loading={sending}
            loadingLabel="Sending"
            disabled={!connectionId || !text.trim() || Boolean(missing)}
            onClick={() => void send()}
            iconLeft={<Icon icon={PaperPlaneTilt} size="sm" decorative />}
          >
            Send test message
          </Button>
          <Text variant="caption" tone="muted">
            {missing ? `Enter the ${missing.label.toLowerCase()} first.` : "Optional. Registering does not send anything."}
          </Text>
        </div>

        {result ? (
          <ModalNote
            tone={result.delivered ? "success" : "danger"}
            title={result.delivered ? "Test message sent" : "The test message was not sent"}
          >
            {result.message}
            {!result.delivered && result.errorCode ? (
              <Text variant="mono-sm" tone="disabled" className="mt-1 block">{result.errorCode}</Text>
            ) : null}
          </ModalNote>
        ) : null}
      </div>
    </ModalSection>
  );
}
