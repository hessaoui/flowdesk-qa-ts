import { defineConfig } from "vitest/config";

const getConfig = () => {
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