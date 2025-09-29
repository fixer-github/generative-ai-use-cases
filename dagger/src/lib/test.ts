import type { Container } from "@dagger.io/dagger";

export async function runLint(container: Container): Promise<Container> {
  console.log("🔍 Running linting...");

  // Use the root 'lint' script which runs: custom-lint:build, web:lint, cdk:lint, cdk:lambda-build-dryrun
  const result = container
    .withExec(["npm", "run", "lint"]);

  await result.sync();
  return result;
}

export async function runTests(container: Container): Promise<Container> {
  console.log("🧪 Running tests...");

  // Use the root 'test' script which runs: web:test (and potentially cdk:test)
  const result = container
    .withExec(["npm", "run", "test"])
    .withExec(["npm", "run", "cdk:test"]);

  await result.sync();
  return result;
}

export async function runQualityChecks(container: Container): Promise<Container> {
  console.log("✨ Running quality checks...");

  let testContainer = container;

  // Run lint and tests in parallel by creating separate containers
  const lintPromise = runLint(container);
  const testPromise = runTests(container);

  // Wait for both to complete
  const [lintResult, testResult] = await Promise.all([lintPromise, testPromise]);

  console.log("✅ Quality checks completed successfully");
  return testResult;
}
