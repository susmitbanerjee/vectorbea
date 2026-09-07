"use client";

import * as React from "react";
import { Text } from "~/components/ui/text";

/* ══════════════════════════════════════════════════════════════════════════════
   THE INSPECTOR'S TWO WRAPPERS.

   Lifted out of `configure-tab` when the team editor became its own file. They
   are shared rather than copied for one reason: `help` is not decoration here.
   Every Section and every Field in this inspector carries a sentence explaining
   what the setting does to a run, and two copies of the wrapper is how half of
   them quietly stop being required.
══════════════════════════════════════════════════════════════════════════════ */

export function Section({
  title, help, children,
}: {
  title: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-subtle bg-surface-raised rounded-md border p-2.5">
      <Text variant="label" tone="primary" className="block">{title}</Text>
      <Text variant="caption" tone="muted" className="mb-2 mt-0.5 block leading-snug">{help}</Text>
      {children}
    </section>
  );
}

export function Field({
  label, help, children,
}: {
  label: string;
  help: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <Text variant="caption" tone="secondary">{label}</Text>
      {children}
      <Text variant="caption" tone="muted" className="leading-snug">{help}</Text>
    </label>
  );
}
