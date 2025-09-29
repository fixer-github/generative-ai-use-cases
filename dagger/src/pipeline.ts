import type { Client } from "@dagger.io/dagger";
import { createNodeContainer, withSourceCode, withCachedNpmInstall } from "./lib/container.js";
import { runBuild } from "./lib/build.js";
import { runQualityChecks } from "./lib/test.js";
import { runDeploy } from "./lib/deploy.js";

export interface PipelineOptions {
  isCI: boolean;
  isDeploy: boolean;
}

export async function pipeline(client: Client, options: PipelineOptions): Promise<void> {
  const { isCI, isDeploy } = options;

  console.log("🔧 Setting up base container...");
  let container = createNodeContainer({ client });

  console.log("📁 Copying source code...");
  container = withSourceCode(container, client);

  console.log("📦 Installing dependencies...");
  container = withCachedNpmInstall(container, client);

  // CI Stage: Always run quality checks and build
  console.log("🚦 Running CI stage...");

  // Run quality checks and build in parallel
  const qualityPromise = runQualityChecks(container);
  const buildPromise = runBuild(container);

  const [qualityResult, buildResult] = await Promise.all([qualityPromise, buildPromise]);

  // Use the build result container for potential deployment
  container = buildResult;

  if (isDeploy) {
    console.log("🚀 Running deployment stage...");
    container = await runDeploy(container);
  } else {
    console.log("⏭️  Skipping deployment stage");
  }

  console.log("🎉 Pipeline completed!");
}
