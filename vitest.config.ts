import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extensions/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["extensions/**/*.ts", "src/**/*.ts"],
      exclude: ["extensions/**/index.ts", "**/*.test.ts"],
      thresholds: {
        lines: 85,
        branches: 80,
        functions: 80,
        statements: 85,
      },
    },
  },
});
