#!/usr/bin/env node

/**
 * Publish test results to Squash via API
 * 
 * Reads JUnit XML reports and imports them into Squash's automated test results.
 * Uses Squash's standard /api/rest/latest/import/results/{iteration_id} endpoint.
 * 
 * Environment variables:
 * - SQUASH_BASE_URL: https://squash.company.com
 * - SQUASH_TOKEN: Your personal API token
 * - SQUASH_ITERATION_ID: Target iteration ID for results
 * 
 * Usage:
 *   npm run publish:squash -- reports/junit.xml
 *   SQUASH_BASE_URL=... SQUASH_TOKEN=... SQUASH_ITERATION_ID=... node scripts/publish-to-squash.mjs reports/junit.xml
 */

import fs from "node:fs";
import { XMLParser } from "fast-xml-parser";

const junitPath = process.argv[2] || "reports/junit.xml";
const baseUrl = process.env.SQUASH_BASE_URL;
const token = process.env.SQUASH_TOKEN;
const iterationId = process.env.SQUASH_ITERATION_ID;

// Validation
if (!baseUrl) {
  console.warn("⚠️  SQUASH_BASE_URL not set. Squash import will be skipped.");
  process.exit(0);
}
if (!token) {
  console.warn("⚠️  SQUASH_TOKEN not set. Squash import will be skipped.");
  process.exit(0);
}
if (!iterationId) {
  console.warn("⚠️  SQUASH_ITERATION_ID not set. Squash import will be skipped.");
  process.exit(0);
}
if (!fs.existsSync(junitPath)) {
  console.error(`❌ JUnit file not found: ${junitPath}`);
  process.exit(1);
}

console.log(`📊 Publishing test results to Squash...`);
console.log(`   Base URL: ${baseUrl}`);
console.log(`   Iteration: ${iterationId}`);
console.log(`   JUnit file: ${junitPath}\n`);

/**
 * Parse JUnit XML and extract test cases
 */
function parseJUnit(xmlPath) {
  const xml = fs.readFileSync(xmlPath, "utf-8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const doc = parser.parse(xml);

  // Handle both testsuites and testsuite root elements
  function toArray(x) {
    return Array.isArray(x) ? x : x ? [x] : [];
  }

  const suites = toArray(doc.testsuites?.testsuite ?? doc.testsuite);
  const tests = [];

  for (const suite of suites) {
    const cases = toArray(suite.testcase);
    for (const tc of cases) {
      const name = tc["@_name"] || "unnamed";
      const timeSec = Number(tc["@_time"] ?? 0);
      const durationMs = Math.round(timeSec * 1000);

      // Extract [TC_XXX_001] reference for Squash mapping
      const m = String(name).match(/\[(TC_[A-Z0-9_:-]+)\]/);
      const reference = m ? m[1] : name;

      let status = "Success";
      let failureDetails = "";

      if (tc.failure) {
        status = "Failure";
        const f = Array.isArray(tc.failure) ? tc.failure[0] : tc.failure;
        failureDetails = (f["#text"] || f["@_message"] || "")
          .toString()
          .slice(0, 2000);
      } else if (tc.error) {
        status = "Failure";
        const e = Array.isArray(tc.error) ? tc.error[0] : tc.error;
        failureDetails = (e["#text"] || e["@_message"] || "")
          .toString()
          .slice(0, 2000);
      } else if (tc.skipped) {
        status = "Blocked";
      }

      tests.push({
        reference,
        status,
        duration: durationMs,
        failure_details: failureDetails ? [failureDetails] : [],
      });
    }
  }

  return tests;
}

/**
 * Import results into Squash
 */
async function importToSquash() {
  try {
    const tests = parseJUnit(junitPath);

    console.log(`📈 Parsed ${tests.length} test cases:`);
    const passed = tests.filter((t) => t.status === "Success").length;
    const failed = tests.filter((t) => t.status === "Failure").length;
    const blocked = tests.filter((t) => t.status === "Blocked").length;
    console.log(`   ✅ Passed:  ${passed}`);
    console.log(`   ❌ Failed:  ${failed}`);
    console.log(`   ⏭️  Blocked: ${blocked}\n`);

    const payload = {
      automated_test_suite: {
        attachments: [],
      },
      tests,
    };

    const url = `${baseUrl
      .replace(/\/$/, "")
      .trim()}/api/rest/latest/import/results/${iterationId}`;

    console.log(`🚀 Posting to Squash: ${url}\n`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await response.text();

    if (!response.ok) {
      console.error(`❌ Squash import failed: HTTP ${response.status}`);
      console.error(body);
      process.exit(1);
    }

    console.log(`✅ Squash import successful!`);
    console.log(`   Status: ${response.status} ${response.statusText}`);

    try {
      const json = JSON.parse(body);
      console.log(`   Response: ${JSON.stringify(json, null, 2)}`);
    } catch {
      console.log(`   Body: ${body.slice(0, 500)}`);
    }

    process.exit(0);
  } catch (error) {
    console.error(`❌ Error during Squash import:`);
    console.error(error);
    process.exit(1);
  }
}

importToSquash();
