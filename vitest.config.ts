import { defineConfig } from "vitest/config";

const getConfig = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const testConfig: any = {
    environment: "node",
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"]
    }
  };

  if (process.env.CI) {
    testConfig.outputFile = { junit: "reports/junit.xml" };
  }

  return defineConfig({
    test: testConfig
  });
};

export default getConfig();