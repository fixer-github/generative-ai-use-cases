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
    .withEnvVariable("NODE_ENV", "production")
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
    client.host().directory(".", { exclude: allExcludes })
  );
}

export function withCachedNpmInstall(container: Container, client: Client): Container {
  const npmCache = client.cacheVolume("npm-cache");

  return container
    .withMountedCache("/root/.npm", npmCache)
    .withFile("/workspace/package.json", client.host().file("package.json"))
    .withFile("/workspace/package-lock.json", client.host().file("package-lock.json"))
    .withExec(["npm", "ci", "--cache=/root/.npm"]);
}

export function withDeploymentTools(container: Container): Container {
  // Add deployment-specific tools (Python, AWS CLI) only when needed
  return container
    .withExec(["apt-get", "install", "-y", "python3", "python3-pip", "python3-venv", "curl", "unzip"])
    .withExec(["pip3", "install", "--break-system-packages", "awscli"]);
}

export function withAWSCredentials(container: Container): Container {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_DEFAULT_REGION || "us-east-1";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials not found in environment variables");
  }

  return container
    .withEnvVariable("AWS_ACCESS_KEY_ID", accessKeyId)
    .withSecretVariable("AWS_SECRET_ACCESS_KEY",
      container.client().setSecret("aws-secret", secretAccessKey)
    )
    .withEnvVariable("AWS_DEFAULT_REGION", region);
}
