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
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }

  return readCicdConfigFromEnv();
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
  };

  if (errors.length > 0) {
    console.error('CI/CD environment configuration is missing or invalid:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  return config;
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
