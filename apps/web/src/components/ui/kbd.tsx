import * as React from "react";
import { cn } from "~/lib/cn";

/**
 * <Kbd> — a key, rendered as a physical cap.
 *
 * Modifier glyphs are resolved per platform at render: a Mac user sees ⌘, a
 * Windows user sees Ctrl. Hard-coding ⌘ is the standard tell that a keyboard
 * surface was designed on a Mac and never checked anywhere else.
 */

/** Detect the platform once, on the client. SSR assumes non-Mac. */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = React.useState(false);
  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform) || /Mac/.test(navigator.userAgent));
  }, []);
  return isMac;
}

const MAC_GLYPHS: Record<string, string> = {
  mod: "⌘", cmd: "⌘", meta: "⌘", ctrl: "⌃", alt: "⌥", opt: "⌥",
  shift: "⇧", enter: "↵", esc: "esc", backspace: "⌫", tab: "⇥",
  up: "↑", down: "↓", left: "←", right: "→",
};

const PC_GLYPHS: Record<string, string> = {
  mod: "Ctrl", cmd: "Ctrl", meta: "Win", ctrl: "Ctrl", alt: "Alt", opt: "Alt",
  shift: "Shift", enter: "Enter", esc: "Esc", backspace: "Backspace", tab: "Tab",
  up: "↑", down: "↓", left: "←", right: "→",
};

export function formatKey(key: string, isMac: boolean): string {
  const map = isMac ? MAC_GLYPHS : PC_GLYPHS;
  return map[key.toLowerCase()] ?? key.toUpperCase();
}

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** One or more keys. "mod+k" renders as ⌘ K or Ctrl K. */
  keys: string;
  size?: "sm" | "md";
}

export function Kbd({ keys, size = "sm", className, ...props }: KbdProps) {
  const isMac = useIsMac();
  // "g then c" is a sequence, "mod+k" is a chord. Both render as separate caps.
  const parts = keys.split(/\+| then /).map((k) => k.trim()).filter(Boolean);
  const isSequence = keys.includes(" then ");

  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} {...props}>
      {parts.map((part, i) => (
        <React.Fragment key={`${part}-${i}`}>
          {isSequence && i > 0 ? (
            <span className="text-fg-disabled font-ui text-caption px-0.5">then</span>
          ) : null}
          <kbd
            className={cn(
              "bg-surface-active border-subtle text-fg-secondary",
              "inline-flex items-center justify-center rounded-xs border",
              "font-code tabular",
              size === "sm" ? "h-4 min-w-4 px-1 text-[10px]" : "h-5 min-w-5 px-1.5 text-mono-sm",
            )}
          >
            {formatKey(part, isMac)}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  );
}
