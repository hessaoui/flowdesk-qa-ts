import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/e2e.spec.ts",  // Only match E2E tests, not Vitest tests
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.WEB_BASE_URL || "http://localhost:3000"
  },
  reporter: process.env.CI
    ? [["junit", { outputFile: "reports/junit.xml" }], ["line"]]
    : [["line"]]
});
