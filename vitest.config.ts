import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "/tmp/vitest-cache",
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.worktrees/**"],
    globals: false,
    testTimeout: 10_000,
  },
});
