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
  staticDirs: [
    "../public",
    // @storybook/nextjs shims next/font/local by emitting the font's source
    // path verbatim (/src/styles/fonts/…) rather than bundling it as an asset,
    // so the directory has to be served at that exact URL or every face 404s and
    // the stories silently fall back to the default serif. Next's own build
    // fingerprints and bundles these properly; this mapping is Storybook-only.
    { from: "../src/styles/fonts", to: "/src/styles/fonts" },
  ],
  typescript: {
    check: false,
    // react-docgen-typescript attaches a __docgenInfo object to every export it
    // believes is a component. Our icon modules export arrays whose members are
    // components (DOMAIN_ICONS, NODE_MARKS), and the loader mis-attributes the
    // docgen object into those arrays, which React then tries to render as a
    // child. Prop tables are not worth that.
    reactDocgen: false,
  },
};

export default config;
