import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/cn";

/**
 * <Text> — the only sanctioned way to set type.
 *
 * Design §4.1 fixes fifteen size/line-height/tracking triples. Each `variant`
 * below binds one of them together with its face and weight, so a call site
 * cannot pick a size without also getting the line-height and tracking that
 * belong to it. That is the point: `text-[13.5px]` is how a type scale dies, and
 * the legacy layer has 2,571 arbitrary pixel values to prove it.
 *
 * The triples themselves live in src/styles/tokens/typography.css under @theme.
 * This component never restates a number.
 */

const text = cva("", {
  variants: {
    variant: {
      // Display — Cabinet Grotesk. Marketing and big telemetry numerals.
      "display-2xl": "font-display text-display-2xl",
      "display-xl": "font-display text-display-xl",
      "display-lg": "font-display text-display-lg",
      "display-md": "font-display text-display-md",

      // Headings — Switzer 600.
      "heading-lg": "font-ui text-heading-lg",
      "heading-md": "font-ui text-heading-md",
      "heading-sm": "font-ui text-heading-sm",

      // Body — Switzer 400.
      "body-lg": "font-ui text-body-lg",
      body: "font-ui text-body",
      "body-sm": "font-ui text-body-sm",

      // Supporting — Switzer.
      label: "font-ui text-label",
      caption: "font-ui text-caption",
      eyebrow: "font-ui text-eyebrow uppercase",

      // Mono — JetBrains Mono. Logs, IDs, JSON.
      mono: "font-code text-mono",
      "mono-sm": "font-code text-mono-sm",
    },
    tone: {
      max: "text-fg-max",
      primary: "text-fg-primary",
      secondary: "text-fg-secondary",
      muted: "text-fg-muted",
      disabled: "text-fg-disabled",
      accent: "text-accent",
      inherit: "",
    },
    /** Tabular figures. On by default for mono and display variants. */
    tabular: { true: "tabular", false: "" },
    truncate: { true: "truncate", false: "" },
  },
  defaultVariants: { variant: "body", tone: "inherit", truncate: false },
});

/** The element each variant renders when `as` is not given. */
const DEFAULT_ELEMENT = {
  "display-2xl": "h1",
  "display-xl": "h2",
  "display-lg": "h1",
  "display-md": "p",
  "heading-lg": "h1",
  "heading-md": "h2",
  "heading-sm": "h3",
  "body-lg": "p",
  body: "p",
  "body-sm": "p",
  label: "span",
  caption: "span",
  eyebrow: "p",
  mono: "span",
  "mono-sm": "span",
} as const satisfies Record<NonNullable<TextVariant>, React.ElementType>;

type TextVariant = NonNullable<VariantProps<typeof text>["variant"]>;

/** Variants that carry numbers often enough to default to tabular figures. */
const TABULAR_BY_DEFAULT = new Set<TextVariant>([
  "display-2xl", "display-xl", "display-lg", "display-md", "mono", "mono-sm",
]);

export interface TextProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "color">,
    Omit<VariantProps<typeof text>, "variant"> {
  variant?: TextVariant;
  /** Override the rendered element. Defaults per variant — see DEFAULT_ELEMENT. */
  as?: React.ElementType;
}

export const Text = React.forwardRef<HTMLElement, TextProps>(function Text(
  { variant = "body", tone, tabular, truncate, as, className, ...props },
  ref,
) {
  const Component = (as ?? DEFAULT_ELEMENT[variant]) as React.ElementType;
  const useTabular = tabular ?? TABULAR_BY_DEFAULT.has(variant);

  return (
    <Component
      ref={ref}
      className={cn(text({ variant, tone, tabular: useTabular, truncate }), className)}
      {...props}
    />
  );
});

export { text as textVariants };
export type { TextVariant };
