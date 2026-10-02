import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
    exclude: ["references/**", "node_modules/**", "dist/**"],
  },
});
