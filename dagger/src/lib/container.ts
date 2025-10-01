import type { Client, Container } from "@dagger.io/dagger";

export interface BaseContainerOptions {
  client: Client;
  nodeVersion?: string;
  workdir?: string;
}

export function createNodeContainer(options: BaseContainerOptions): Container {
  const { client, nodeVersion = "24", workdir = "/workspace" } = options;

  return client
    .container()
    .from(`node:${nodeVersion}-slim`)
    .withExec(["apt-get", "update"])
    .withExec(["apt-get", "install", "-y", "git"])
    .withExec(["npm", "install", "-g", "aws-cdk@latest"])
    .withWorkdir(workdir)
    .withEnvVariable("CI", "true")
    .withEnvVariable("FORCE_COLOR", "1");
}

export function withSourceCode(container: Container, client: Client, excludePaths: string[] = []): Container {
  const defaultExcludes = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".dagger",
    "dagger",
    ".github",
    "**/.DS_Store",
    "**/npm-debug.log*",
    "**/yarn-debug.log*",
    "**/yarn-error.log*"
  ];

  const allExcludes = [...defaultExcludes, ...excludePaths];

  return container.withDirectory(
    "/workspace",
    client.host().directory("..", { exclude: allExcludes })
  );
}

export function withCachedNpmInstall(container: Container, client: Client): Container {
  const npmCache = client.cacheVolume("npm-cache");

  return container
    .withMountedCache("/root/.npm", npmCache)
    .withExec(["npm", "ci", "--cache=/root/.npm"]);
}

export function withDeploymentTools(container: Container): Container {
  // Add deployment-specific tools (Python, AWS CLI) only when needed
  return container
    .withExec(["apt-get", "install", "-y", "python3", "python3-pip", "python3-venv", "curl", "unzip"])
    .withExec(["pip3", "install", "--break-system-packages", "awscli"]);
}

export function withOIDCCredentials(container: Container, client: Client): Container {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const account = process.env.CDK_DEFAULT_ACCOUNT || "";

  let result = container
    .withEnvVariable("AWS_REGION", region)
    .withEnvVariable("AWS_DEFAULT_REGION", region)
    .withEnvVariable("CDK_DEFAULT_REGION", region)
    .withEnvVariable("CDK_DEFAULT_ACCOUNT", account);

  // Pass AWS credentials as secrets (set by configure-aws-credentials action)
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  if (accessKeyId) {
    result = result.withSecretVariable("AWS_ACCESS_KEY_ID", client.setSecret("aws-access-key", accessKeyId));
  }
  if (secretAccessKey) {
    result = result.withSecretVariable("AWS_SECRET_ACCESS_KEY", client.setSecret("aws-secret-key", secretAccessKey));
  }
  if (sessionToken) {
    result = result.withSecretVariable("AWS_SESSION_TOKEN", client.setSecret("aws-session-token", sessionToken));
  }

  return result;
}

export function withCDKConfigFromBase64(container: Container): Container {
  const cdkConfigBase64 = process.env.CDK_CONFIG_BASE64;

  if (!cdkConfigBase64) {
    throw new Error("CDK_CONFIG_BASE64 environment variable not found. Please set this secret in GitHub.");
  }

  console.log("📄 Decoding and placing cdk.json...");

  // Decode base64 and write to packages/cdk/cdk.json
  return container
    .withExec([
      "sh", "-c",
      `echo '${cdkConfigBase64}' | base64 -d > packages/cdk/cdk.json`
    ]);
}
