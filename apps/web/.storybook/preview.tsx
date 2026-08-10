import * as React from "react";
import type { Preview } from "@storybook/nextjs";
import { withThemeByClassName } from "@storybook/addon-themes";

// Pulls in Tailwind v4, the Ink & Iris tokens, and the frozen legacy config.
import "../app/globals.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    // Backgrounds come from the theme decorator below, so Storybook's own
    // background switcher would only ever fight it.
    backgrounds: { disable: true },
    a11y: {
      config: {
        rules: [
          // Design direction §14: 4.5:1 body, 3:1 large text and UI glyphs.
          { id: "color-contrast", enabled: true },
        ],
      },
    },
  },

  decorators: [
    /**
     * Dark/light toggle in the toolbar. Dark is first because it is the product
     * default (design §3.2) — stories must be authored dark-first.
     */
    withThemeByClassName({
      themes: { dark: "dark", light: "" },
      defaultTheme: "dark",
    }),

    // Paint the canvas with the themed app surface so components are never
    // reviewed against a white void that does not exist in the product.
    (Story) => (
      <div className="bg-surface-app text-fg-primary font-ui min-h-screen p-6">
        <Story />
      </div>
    ),
  ],
};

export default preview;
