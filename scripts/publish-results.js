#!/usr/bin/env node

/**
 * Publish test results to Squash (or any endpoint)
 * 
 * Usage: npm run publish:results
 * 
 * This script reads JUnit XML reports and posts structured results
 * to an endpoint for test result tracking and analytics.
 * 
 * Environment variables:
 * - SQUASH_ENDPOINT: URL to post results (default: http://localhost:3000/api/results)
 * - SQUASH_TOKEN: Optional auth token
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const JUNIT_FILE = path.join(projectRoot, "reports", "junit.xml");
const JUNIT_INTEGRATION_FILE = path.join(projectRoot, "reports", "junit-integration.xml");
const COVERAGE_FILE = path.join(projectRoot, "coverage", "lcov.info");

const SQUASH_ENDPOINT =
  process.env.SQUASH_ENDPOINT || "http://localhost:3000/api/results";
const SQUASH_TOKEN = process.env.SQUASH_TOKEN;

/**
 * Parse JUnit XML file
 */
function parseJUnitXML(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  JUnit file not found: ${filePath}`);
    return null;
  }

  const xml = fs.readFileSync(filePath, "utf8");

  // Simple regex-based parsing (no external dependencies)
  const testsMatch = xml.match(/tests="(\d+)"/);
  const failuresMatch = xml.match(/failures="(\d+)"/);
  const skippedMatch = xml.match(/skipped="(\d+)"/);
  const timeMatch = xml.match(/time="([\d.]+)"/);

  return {
    tests: parseInt(testsMatch?.[1] || "0", 10),
    failures: parseInt(failuresMatch?.[1] || "0", 10),
    skipped: parseInt(skippedMatch?.[1] || "0", 10),
    time: parseFloat(timeMatch?.[1] || "0"),
  };
}

/**
 * Get coverage metrics if available
 */
function getCoverageMetrics() {
  if (!fs.existsSync(COVERAGE_FILE)) {
    return null;
  }

  const lcov = fs.readFileSync(COVERAGE_FILE, "utf8");
  const linesMatch = lcov.match(/LF:(\d+)/g);
  const linesCoveredMatch = lcov.match(/LH:(\d+)/g);

  if (!linesMatch || !linesCoveredMatch) return null;

  const totalLines = linesMatch.reduce((sum, m) => sum + parseInt(m.split(":")[1], 10), 0);
  const coveredLines = linesCoveredMatch.reduce((sum, m) => sum + parseInt(m.split(":")[1], 10), 0);
  const percentage = totalLines > 0 ? ((coveredLines / totalLines) * 100).toFixed(2) : 0;

  return {
    lines_total: totalLines,
    lines_covered: coveredLines,
    coverage_percentage: parseFloat(percentage),
  };
}

/**
 * Build and publish results
 */
async function publishResults() {
  console.log("📊 Publishing test results to Squash...\n");

  // Parse unit test results
  const unitTests = parseJUnitXML(JUNIT_FILE);
  const integrationTests = parseJUnitXML(JUNIT_INTEGRATION_FILE);
  const coverage = getCoverageMetrics();

  if (!unitTests && !integrationTests) {
    console.error("❌ No JUnit reports found. Run tests first with: npm test");
    process.exit(1);
  }

  // Aggregate results
  const totalTests = (unitTests?.tests || 0) + (integrationTests?.tests || 0);
  const totalFailures = (unitTests?.failures || 0) + (integrationTests?.failures || 0);
  const totalSkipped = (unitTests?.skipped || 0) + (integrationTests?.skipped || 0);
  const totalTime = (unitTests?.time || 0) + (integrationTests?.time || 0);

  const payload = {
    timestamp: new Date().toISOString(),
    git_commit: getGitCommit(),
    environment: "local", // or process.env.CI ? "ci" : "local"
    test_summary: {
      total_tests: totalTests,
      passed_tests: totalTests - totalFailures - totalSkipped,
      failed_tests: totalFailures,
      skipped_tests: totalSkipped,
      duration_seconds: totalTime,
    },
    unit_tests: unitTests ? {
      total: unitTests.tests,
      passed: unitTests.tests - unitTests.failures - unitTests.skipped,
      failed: unitTests.failures,
      skipped: unitTests.skipped,
    } : null,
    integration_tests: integrationTests ? {
      total: integrationTests.tests,
      passed: integrationTests.tests - integrationTests.failures - integrationTests.skipped,
      failed: integrationTests.failures,
      skipped: integrationTests.skipped,
    } : null,
    coverage: coverage,
    artifacts: {
      junit_report: "reports/junit.xml",
      junit_integration: "reports/junit-integration.xml",
      coverage_report: "coverage/lcov-report/index.html",
    },
  };

  // Log summary
  console.log("📈 Test Results Summary:");
  console.log(`   Total Tests:  ${payload.test_summary.total_tests}`);
  console.log(`   ✅ Passed:    ${payload.test_summary.passed_tests}`);
  console.log(`   ❌ Failed:    ${payload.test_summary.failed_tests}`);
  console.log(`   ⏭️  Skipped:   ${payload.test_summary.skipped_tests}`);
  console.log(`   ⏱️  Duration:  ${payload.test_summary.duration_seconds.toFixed(2)}s\n`);

  if (coverage) {
    console.log(`📊 Code Coverage: ${coverage.coverage_percentage}%`);
    console.log(`   Lines:     ${coverage.lines_covered}/${coverage.lines_total}\n`);
  }

  // POST to endpoint
  try {
    const headers = {
      "Content-Type": "application/json",
    };

    if (SQUASH_TOKEN) {
      headers["Authorization"] = `Bearer ${SQUASH_TOKEN}`;
    }

    console.log(`🚀 Posting to: ${SQUASH_ENDPOINT}`);
    const response = await fetch(SQUASH_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log("✅ Results published successfully!");
      console.log(`   Response: ${response.status} ${response.statusText}\n`);
    } else {
      console.warn(`⚠️  Endpoint returned ${response.status}: ${response.statusText}`);
      console.log("   (This is OK - endpoint may not be available)\n");
    }
  } catch (error) {
    console.warn(`⚠️  Could not connect to endpoint: ${error.message}`);
    console.log("   Results would be published here in production:\n");
    console.log(JSON.stringify(payload, null, 2));
  }
}

/**
 * Get current git commit hash
 */
function getGitCommit() {
  try {
    const gitDir = path.join(projectRoot, ".git");
    if (fs.existsSync(gitDir)) {
      const headFile = path.join(gitDir, "HEAD");
      const head = fs.readFileSync(headFile, "utf8").trim();
      const refMatch = head.match(/ref: refs\/heads\/(.+)/);
      
      if (refMatch) {
        const refFile = path.join(gitDir, "refs", "heads", refMatch[1]);
        if (fs.existsSync(refFile)) {
          return fs.readFileSync(refFile, "utf8").trim().substring(0, 7);
        }
      }
    }
  } catch {
    // Silent fail - git info is optional
  }
  return "unknown";
}

// Run
publishResults().catch((error) => {
  console.error("❌ Error publishing results:", error);
  process.exit(1);
});
