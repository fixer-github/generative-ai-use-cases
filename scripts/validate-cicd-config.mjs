import fs from 'node:fs';
import path from 'node:path';
import { readCicdConfig } from './lib/cicd-config.mjs';

const repoRoot = process.cwd();
const cdkPath = path.join(repoRoot, 'packages/cdk/cdk.json');

const manifest = readCicdConfig({ repoRoot });
const cdk = JSON.parse(fs.readFileSync(cdkPath, 'utf8'));
const context = cdk.context ?? {};

const errors = [];
const warnings = [];

function requireEqual(label, actual, expected) {
  if (actual !== expected) {
    errors.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function parseArn(arn) {
  const parts = arn.split(':');
  if (parts.length < 6 || parts[0] !== 'arn') {
    throw new Error(`Invalid ARN: ${arn}`);
  }
  return {
    service: parts[2],
    region: parts[3],
    accountId: parts[4],
    resource: parts.slice(5).join(':'),
  };
}

requireEqual('cdk context env', context.env, manifest.cdkEnv);
requireEqual(
  'cdk context modelRegion',
  context.modelRegion,
  manifest.modelRegion
);
requireEqual(
  'cdk context agentCoreRegion',
  context.agentCoreRegion,
  manifest.agentCoreRegion
);

const cdkRuntimeArns = new Set(
  (context.agentCoreExternalRuntimes ?? []).map((runtime) => runtime.arn)
);

if (!manifest.outputs?.ssmParameterPrefix) {
  errors.push('outputs.ssmParameterPrefix is required');
} else if (!/^\/[A-Za-z0-9_.\-/]+$/.test(manifest.outputs.ssmParameterPrefix)) {
  errors.push(
    `outputs.ssmParameterPrefix has invalid characters: ${manifest.outputs.ssmParameterPrefix}`
  );
} else if (manifest.outputs.ssmParameterPrefix.endsWith('/')) {
  errors.push(
    `outputs.ssmParameterPrefix must not end with slash: ${manifest.outputs.ssmParameterPrefix}`
  );
}

for (const runtime of manifest.agentCoreRuntimes) {
  const arn = parseArn(runtime.arn);
  requireEqual(
    `${runtime.key} ARN account`,
    arn.accountId,
    manifest.awsAccountId
  );
  requireEqual(
    `${runtime.key} ARN region`,
    arn.region,
    manifest.agentCoreRegion
  );

  if (runtime.required && !cdkRuntimeArns.has(runtime.arn)) {
    errors.push(
      `${runtime.key}: required runtime ARN is not present in cdk.json`
    );
  }
  if (!runtime.required && !cdkRuntimeArns.has(runtime.arn)) {
    warnings.push(
      `${runtime.key}: optional runtime ARN is not present in cdk.json`
    );
  }
}

for (const runtime of context.agentCoreExternalRuntimes ?? []) {
  const arn = parseArn(runtime.arn);
  if (arn.accountId !== manifest.awsAccountId) {
    errors.push(`${runtime.name}: cdk.json ARN account is ${arn.accountId}`);
  }
  if (arn.region !== manifest.agentCoreRegion) {
    errors.push(`${runtime.name}: cdk.json ARN region is ${arn.region}`);
  }
}

for (const warning of warnings) {
  console.warn(`WARN: ${warning}`);
}

if (errors.length > 0) {
  console.error('CI/CD configuration validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('CI/CD configuration validation passed.');
