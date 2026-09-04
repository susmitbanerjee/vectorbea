"use client";

import * as React from "react";

/* ══════════════════════════════════════════════════════════════════════════════
   THE KEYBOARD SYSTEM

   One global registry, one listener. Components register shortcuts on mount and
   the shortcuts sheet reads the same registry, so a shortcut cannot exist
   without being discoverable — the usual failure is a power-user binding that
   only the person who wrote it knows about.

   Two rules the implementation exists to enforce:

   1. SHORTCUTS NEVER FIRE WHILE TEXT IS FOCUSED. Typing "g" in a search box must
      type a g. The guard covers input, textarea, select, contenteditable and any
      element that has opted out with [data-no-shortcuts].
   2. `mod` means ⌘ on Mac and Ctrl elsewhere, resolved at match time.

   Sequences ("g then c") are supported with a 1.2s window, and a partial
   sequence is exposed so the UI can show what is pending.
══════════════════════════════════════════════════════════════════════════════ */

export type ShortcutScope = "global" | "palette" | "dialog";

export interface Shortcut {
  /** "mod+k", "g then c", "?", "/" */
  keys: string;
  /** Shown in the shortcuts sheet. */
  label: string;
  /** Sheet grouping. */
  group: string;
  handler: (event: KeyboardEvent) => void;
  /** Allow firing even while a text field has focus. Escape needs this. */
  allowInInput?: boolean;
  /** Hide from the sheet (rare — prefer discoverability). */
  hidden?: boolean;
}

type Registry = Map<string, Shortcut>;

interface KeyboardContextValue {
  register: (id: string, shortcut: Shortcut) => () => void;
  shortcuts: Shortcut[];
  /** Keys already pressed in an in-flight sequence, e.g. ["g"]. */
  pending: string[];
}

const KeyboardContext = React.createContext<KeyboardContextValue | null>(null);

const SEQUENCE_WINDOW_MS = 1200;

/** True when the event target is somewhere the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[data-no-shortcuts]")) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Punctuation that some layouts and automation drivers report as the UNSHIFTED
 * key even when Shift is held. Without this, "?" arrives as "/" and silently
 * triggers the search shortcut instead of the shortcuts sheet — the two are
 * adjacent bindings, so the bug looks like "? does nothing" rather than an
 * obvious error.
 */
const SHIFTED: Record<string, string> = {
  "/": "?", ",": "<", ".": ">", ";": ":", "'": '"',
  "[": "{", "]": "}", "\\": "|", "-": "_", "=": "+",
  "1": "!", "2": "@", "3": "#", "4": "$", "5": "%",
  "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
};

/** Normalise a KeyboardEvent into "mod+k" / "?" / "g" form. */
function eventToChord(e: KeyboardEvent): string {
  const parts: string[] = [];
  const mod = e.metaKey || e.ctrlKey;
  if (mod) parts.push("mod");
  if (e.altKey) parts.push("alt");
  // Shift is only meaningful for non-printable keys; "?" already encodes it.
  if (e.shiftKey && e.key.length > 1) parts.push("shift");

  let key = e.key.toLowerCase();
  if (e.shiftKey && !mod && SHIFTED[key]) key = SHIFTED[key];
  parts.push(key === " " ? "space" : key);
  return parts.join("+");
}

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const registry = React.useRef<Registry>(new Map());
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  const [pending, setPending] = React.useState<string[]>([]);
  const pendingRef = React.useRef<string[]>([]);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = React.useCallback((id: string, shortcut: Shortcut) => {
    registry.current.set(id, shortcut);
    force();
    return () => {
      registry.current.delete(id);
      force();
    };
  }, []);

  const clearPending = React.useCallback(() => {
    pendingRef.current = [];
    setPending([]);
    if (timer.current) clearTimeout(timer.current);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);
      const chord = eventToChord(e);

      // ── Chords (mod+k, ?, /) ────────────────────────────────────────────
      for (const shortcut of registry.current.values()) {
        if (shortcut.keys.includes(" then ")) continue;
        if (shortcut.keys !== chord) continue;
        if (typing && !shortcut.allowInInput) continue;
        e.preventDefault();
        clearPending();
        shortcut.handler(e);
        return;
      }

      // ── Sequences (g then c) ────────────────────────────────────────────
      // Never while typing, and never with a modifier held.
      if (typing || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) {
        if (e.key === "Escape") clearPending();
        return;
      }

      const next = [...pendingRef.current, e.key.toLowerCase()];
      const asSequence = next.join(" then ");

      const exact = [...registry.current.values()].find(
        (s) => s.keys.includes(" then ") && s.keys === asSequence,
      );
      if (exact) {
        e.preventDefault();
        clearPending();
        exact.handler(e);
        return;
      }

      const isPrefix = [...registry.current.values()].some(
        (s) => s.keys.includes(" then ") && s.keys.startsWith(`${asSequence} then `),
      );
      if (isPrefix) {
        e.preventDefault();
        pendingRef.current = next;
        setPending(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(clearPending, SEQUENCE_WINDOW_MS);
        return;
      }

      clearPending();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [clearPending]);

  const value = React.useMemo<KeyboardContextValue>(
    () => ({ register, shortcuts: [...registry.current.values()], pending }),
    // force() bumps this on every registry change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [register, pending, registry.current.size],
  );

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
}

export function useKeyboard(): KeyboardContextValue {
  const ctx = React.useContext(KeyboardContext);
  if (!ctx) throw new Error("useKeyboard must be used inside <KeyboardProvider>");
  return ctx;
}

/**
 * Register a shortcut for the lifetime of the calling component.
 *
 * The handler is kept in a ref so callers do not have to memoise it — a stale
 * closure in a keyboard handler is a bug that only shows up under interaction.
 */
export function useShortcut(shortcut: Shortcut, deps: React.DependencyList = []) {
  const { register } = useKeyboard();
  const id = React.useId();
  const handlerRef = React.useRef(shortcut.handler);
  handlerRef.current = shortcut.handler;

  React.useEffect(
    () => register(id, { ...shortcut, handler: (e) => handlerRef.current(e) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, register, shortcut.keys, shortcut.label, shortcut.group, ...deps],
  );
}
