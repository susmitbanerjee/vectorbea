import type { StorybookConfig } from "@storybook/nextjs";

/**
 * Storybook is the component library for the revamp (design direction §13) and
 * the review surface for the P04 and P06 gates.
 *
 * Only src/** is included. The legacy layer in components/** is deliberately not
 * documented here — it is being replaced, not catalogued.
 *
 * VERSION NOTE: the execution plan specifies Storybook 8, but Storybook 8's
 * webpack5 builder crashes against Next 15.5's bundled webpack
 * ("Cannot read properties of undefined (reading 'tap')"). Storybook 9 is the
 * supported combination for Next 15.5. See /docs/audit/CURRENT-STATE.md §9.6.
 * Storybook 9 folds addon-essentials into the core, so it is no longer listed.
 */
const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-themes"],
  framework: {
    name: "@storybook/nextjs",
    options: {},
  },
  staticDirs: ["../public"],
  typescript: {
    check: false,
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
