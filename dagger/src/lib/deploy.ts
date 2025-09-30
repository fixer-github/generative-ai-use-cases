import type { Container } from "@dagger.io/dagger";
import { withDeploymentTools, withOIDCCredentials, withCDKConfigFromBase64 } from "./container.js";

export async function bootstrapCDK(container: Container): Promise<Container> {
  console.log("🔧 Injecting CDK configuration...");
  let deployContainer = withCDKConfigFromBase64(container);

  console.log("🏗️  Checking CDK bootstrap...");

  // Add deployment tools (Python, AWS CLI) then OIDC credentials
  deployContainer = withDeploymentTools(deployContainer);
  const awsContainer = withOIDCCredentials(deployContainer);

  // Check if bootstrap is needed (this will succeed if already bootstrapped)
  const result = awsContainer
    .withExec(["npm", "-w", "packages/cdk", "run", "cdk", "bootstrap", "--verbose"]);

  await result.sync();
  return result;
}

export async function deployCDK(container: Container): Promise<Container> {
  console.log("🚀 Deploying CDK stacks to production...");

  // Deployment tools and config already added in bootstrap step, just need credentials
  const awsContainer = withOIDCCredentials(container);

  const result = awsContainer
    .withExec([
      "npm", "-w", "packages/cdk", "run", "cdk", "deploy",
      "--all",
      "--require-approval", "never",
      "--verbose"
    ]);

  await result.sync();
  return result;
}

export async function validateDeployment(container: Container): Promise<Container> {
  console.log("🔍 Validating deployment...");

  // Deployment tools already added, just need credentials
  const awsContainer = withOIDCCredentials(container);

  const result = awsContainer
    .withExec(["npm", "-w", "packages/cdk", "run", "cdk", "ls"])
    .withExec(["aws", "sts", "get-caller-identity"]);

  await result.sync();
  return result;
}

export async function runDeploy(container: Container): Promise<Container> {
  console.log("🌟 Starting production deployment...");

  let deployContainer = container;

  // Run deployment steps in sequence
  deployContainer = await bootstrapCDK(deployContainer);
  deployContainer = await deployCDK(deployContainer);
  deployContainer = await validateDeployment(deployContainer);

  console.log("✅ Deployment completed successfully");
  return deployContainer;
}
