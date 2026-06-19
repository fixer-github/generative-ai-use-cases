import { spawnSync } from 'node:child_process';
import { readCicdConfig } from './lib/cicd-config.mjs';

const repoRoot = process.cwd();
const manifest = readCicdConfig({ repoRoot });
const errors = [];

function parseRuntimeArn(arn) {
  const match = arn.match(
    /^arn:aws:bedrock-agentcore:([^:]+):([0-9]{12}):runtime\/([A-Za-z][A-Za-z0-9_]{0,99}-[A-Za-z0-9]{10})$/
  );
  if (!match) {
    throw new Error(`Invalid AgentCore runtime ARN: ${arn}`);
  }
  return {
    region: match[1],
    accountId: match[2],
    runtimeId: match[3],
  };
}

function getRuntime(runtime, parsedArn) {
  const result = spawnSync(
    'aws',
    [
      'bedrock-agentcore-control',
      'get-agent-runtime',
      '--agent-runtime-id',
      parsedArn.runtimeId,
      '--region',
      parsedArn.region,
      '--output',
      'json',
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim();
    throw new Error(`${runtime.key}: ${message}`);
  }

  return JSON.parse(result.stdout);
}

for (const runtime of manifest.agentCoreRuntimes) {
  const parsedArn = parseRuntimeArn(runtime.arn);

  if (parsedArn.accountId !== manifest.awsAccountId) {
    errors.push(`${runtime.key}: ARN account is ${parsedArn.accountId}`);
    continue;
  }

  if (parsedArn.region !== manifest.agentCoreRegion) {
    errors.push(`${runtime.key}: ARN region is ${parsedArn.region}`);
    continue;
  }

  try {
    const actual = getRuntime(runtime, parsedArn);
    if (actual.agentRuntimeArn !== runtime.arn) {
      errors.push(`${runtime.key}: AWS returned ARN ${actual.agentRuntimeArn}`);
    }
    if (actual.status !== 'READY') {
      const message = `${runtime.key}: runtime status is ${actual.status}`;
      if (runtime.required) {
        errors.push(message);
      } else {
        console.warn(`WARN: ${message}`);
      }
    }
    console.log(`${runtime.key}: ${actual.status} (${actual.agentRuntimeArn})`);
  } catch (error) {
    if (runtime.required) {
      errors.push(error.message);
    } else {
      console.warn(`WARN: ${error.message}`);
    }
  }
}

if (errors.length > 0) {
  console.error('AgentCore runtime validation failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('AgentCore runtime validation passed.');
