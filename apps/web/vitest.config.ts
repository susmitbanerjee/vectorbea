import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
    globals: true,
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
    // `server-only` throws at import time in non-Next.js environments.
    // Stub it out so server modules can be imported in unit tests.
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Mirrors tsconfig. Without it seo.test.ts cannot even load app/sitemap.ts,
      // which imports the docs registry through `~`.
      "~": path.resolve(__dirname, "src"),
      // Stub `server-only` so Vitest doesn't error on the boundary check
      "server-only": path.resolve(__dirname, "__tests__/mocks/server-only.ts"),
    },
  },
});
