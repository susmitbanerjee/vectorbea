"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";

/**
 * Password requirements, shown UP FRONT.
 *
 * Revealing rules only after a failed submit is the standard pattern and it is
 * hostile: it asks someone to guess, tells them they guessed wrong, and makes
 * them retype. The list is visible from the first render and ticks off live, so
 * the rules are information rather than a punishment.
 *
 * Strength is scored on the requirements themselves plus length, not on an
 * entropy library — a meter that disagrees with the stated rules is worse than
 * no meter.
 */

export interface Rule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const PASSWORD_RULES: Rule[] = [
  { id: "length", label: "At least 12 characters", test: (v) => v.length >= 12 },
  { id: "case", label: "Upper and lower case", test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { id: "number", label: "A number", test: (v) => /\d/.test(v) },
  { id: "symbol", label: "A symbol", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function passwordMeetsRules(value: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(value));
}

type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; tone: string };

export function scorePassword(value: string): Strength {
  if (!value) return { score: 0, label: "Enter a password", tone: "bg-surface-active" };

  const passed = PASSWORD_RULES.filter((r) => r.test(value)).length;
  const long = value.length >= 16;
  const veryLong = value.length >= 20;

  // A long passphrase that misses the symbol rule is stronger than a short
  // string that technically satisfies all four, so length is scored separately.
  let score = passed;
  if (veryLong) score = Math.min(4, score + 1);

  if (score <= 1) return { score: 1, label: "Too weak", tone: "bg-status-failed" };
  if (score === 2) return { score: 2, label: "Weak", tone: "bg-status-waiting" };
  if (score === 3) return { score: 3, label: long ? "Good" : "Fair", tone: "bg-status-waiting" };
  return { score: 4, label: "Strong", tone: "bg-status-success" };
}

export function PasswordStrength({ value }: { value: string }) {
  const strength = scorePassword(value);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors duration-base",
                i <= strength.score ? strength.tone : "bg-surface-active",
              )}
            />
          ))}
        </div>
        <Text variant="caption" tone="muted" className="w-20 shrink-0 text-right">
          {strength.label}
        </Text>
      </div>

      {/* Announced politely so a screen reader hears the change without the
          meter stealing focus mid-typing. */}
      <span className="sr-only" aria-live="polite">
        Password strength: {strength.label}
      </span>

      <ul className="mt-2.5 grid gap-1">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(value);
          return (
            <li key={rule.id} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-3.5 shrink-0 place-items-center rounded-full border",
                  met
                    ? "bg-status-success-subtle border-status-success-border text-status-success"
                    : "border-subtle text-fg-disabled",
                )}
              >
                <svg viewBox="0 0 16 16" className="size-2.5" fill="none">
                  {met ? (
                    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="2.4"
                      strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <circle cx="8" cy="8" r="2" fill="currentColor" />
                  )}
                </svg>
              </span>
              <Text variant="caption" tone={met ? "secondary" : "muted"}>{rule.label}</Text>
              <span className="sr-only">{met ? " — met" : " — not yet met"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
