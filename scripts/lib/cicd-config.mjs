import fs from 'node:fs';
import path from 'node:path';

export function readCicdConfig(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const manifestPath = options.manifestPath
    ? path.resolve(repoRoot, options.manifestPath)
    : process.env.CI_MANIFEST_PATH
      ? path.resolve(repoRoot, process.env.CI_MANIFEST_PATH)
      : path.join(repoRoot, 'config/cicd/dev.json');

  if (fs.existsSync(manifestPath)) {
    return normalizeCicdConfig(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    );
  }

  return readCicdConfigFromEnv();
}

export function normalizeCicdConfig(config) {
  return {
    ...config,
    cdkContext: config.cdkContext ?? {},
    agentCoreRuntimes: normalizeAgentCoreRuntimes(
      config.agentCoreRuntimes ?? config.agentCoreExternalRuntimes ?? []
    ),
    agentCoreExternalRuntimes: normalizeAgentCoreRuntimes(
      config.agentCoreExternalRuntimes ??
        config.cdkContext?.agentCoreExternalRuntimes ??
        config.agentCoreRuntimes ??
        []
    ).map(toCdkRuntime),
  };
}

export function normalizeAgentCoreRuntimes(runtimes) {
  if (!Array.isArray(runtimes)) {
    return [];
  }

  return runtimes.map((runtime) => {
    const key = runtime.key ?? runtime.name;
    return {
      ...runtime,
      key,
      name: runtime.name ?? key,
      required: runtime.required ?? true,
    };
  });
}

function toCdkRuntime(runtime) {
  const cdkRuntime = {
    name: runtime.name,
    arn: runtime.arn,
  };

  if (runtime.displayName) {
    cdkRuntime.displayName = runtime.displayName;
  }
  if (runtime.description) {
    cdkRuntime.description = runtime.description;
  }
  if (runtime.apps) {
    cdkRuntime.apps = runtime.apps;
  }

  return cdkRuntime;
}

function readCicdConfigFromEnv() {
  const errors = [];

  const config = {
    environmentName: readEnv('ENVIRONMENT_NAME', errors),
    cdkEnv: readEnv('CDK_CONTEXT_ENV', errors),
    awsAccountId: readEnv('AWS_ACCOUNT_ID', errors),
    deploymentRegion: readEnv('DEPLOYMENT_REGION', errors),
    modelRegion: readEnv('MODEL_REGION', errors),
    agentCoreRegion: readEnv('AGENTCORE_REGION', errors),
    stacks: {
      genu: readEnv('GENU_STACK_NAME', errors),
      agentCore: process.env.AGENTCORE_STACK_NAME,
      manualRag: process.env.MANUAL_RAG_STACK_NAME,
    },
    outputs: {
      ssmParameterPrefix: readEnv('GENU_OUTPUTS_SSM_PREFIX', errors),
    },
    agentCoreRuntimes: readJsonEnv('AGENTCORE_RUNTIMES_JSON', errors),
    cdkContext: readOptionalJsonEnv('CDK_CONTEXT_JSON', errors),
  };

  if (errors.length > 0) {
    console.error('CI/CD environment configuration is missing or invalid:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  return normalizeCicdConfig(config);
}

function readEnv(name, errors) {
  const value = process.env[name];
  if (!value) {
    errors.push(`${name} is required`);
  }
  return value;
}

function readJsonEnv(name, errors) {
  const value = readEnv(name, errors);
  if (!value) {
    return [];
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    errors.push(`${name} must be valid JSON: ${error.message}`);
    return [];
  }
}

function readOptionalJsonEnv(name, errors) {
  const value = process.env[name];
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    errors.push(`${name} must be valid JSON: ${error.message}`);
    return {};
  }
}
