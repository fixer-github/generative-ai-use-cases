#!/usr/bin/env tsx

import { connect } from "@dagger.io/dagger";
import { pipeline } from "./pipeline.js";

const args = process.argv.slice(2);
const isCI = args.includes("--env=ci") || process.env.CI === "true";
const isDeploy = args.includes("--env=deploy") || (isCI && (process.env.GITHUB_REF === "refs/heads/main" || process.env.GITHUB_REF?.startsWith("refs/tags/v")));

async function main() {
  console.log("🚀 Starting Dagger pipeline...");
  console.log(`Environment: ${isCI ? "CI" : "Local"}`);
  console.log(`Deploy enabled: ${isDeploy}`);

  await connect(async (client) => {
    await pipeline(client, { isCI, isDeploy });
  }, { LogOutput: process.stderr });

  console.log("✅ Pipeline completed successfully");
}

main().catch((error) => {
  console.error("❌ Pipeline failed:", error);
  process.exit(1);
});
