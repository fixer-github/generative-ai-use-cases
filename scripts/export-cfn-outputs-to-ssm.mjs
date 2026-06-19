import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readCicdConfig } from './lib/cicd-config.mjs';

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));
const manifest = readCicdConfig({
  repoRoot,
  manifestPath: args.manifest,
});
const outputFile = args['output-file']
  ? path.resolve(repoRoot, args['output-file'])
  : undefined;

const region = manifest.deploymentRegion;
const stackName = manifest.stacks?.genu;
const parameterPrefix = manifest.outputs?.ssmParameterPrefix;
const dryRun = args['dry-run'] === true;

const errors = [];

if (!region) {
  errors.push('manifest.deploymentRegion is required');
}
if (!stackName) {
  errors.push('manifest.stacks.genu is required');
}
if (!parameterPrefix) {
  errors.push('manifest.outputs.ssmParameterPrefix is required');
} else if (!/^\/[A-Za-z0-9_.\-/]+$/.test(parameterPrefix)) {
  errors.push(
    `manifest.outputs.ssmParameterPrefix has invalid characters: ${parameterPrefix}`
  );
} else if (parameterPrefix.endsWith('/')) {
  errors.push(
    `manifest.outputs.ssmParameterPrefix must not end with slash: ${parameterPrefix}`
  );
}

if (errors.length > 0) {
  fail('CloudFormation output export configuration is invalid:', errors);
}

const outputs = args['input-file']
  ? readOutputsFromFile(path.resolve(repoRoot, args['input-file']))
  : describeStackOutputs(stackName, region);

if (outputs.length === 0) {
  fail(`CloudFormation stack ${stackName} has no Outputs.`);
}

const parameters = outputs.map((output) => ({
  outputKey: output.OutputKey,
  outputValue: output.OutputValue,
  description: output.Description,
  parameterName: `${parameterPrefix}/${output.OutputKey}`,
}));

for (const parameter of parameters) {
  if (
    typeof parameter.outputKey !== 'string' ||
    parameter.outputKey.length === 0
  ) {
    fail('CloudFormation output is missing OutputKey.');
  }
  if (typeof parameter.outputValue !== 'string') {
    fail(
      `${parameter.outputKey}: CloudFormation output is missing OutputValue.`
    );
  }
}

for (const parameter of parameters) {
  if (dryRun) {
    console.log(
      `DRY-RUN put ${parameter.parameterName} (${parameter.outputValue.length} chars)`
    );
    continue;
  }

  runAws([
    'ssm',
    'put-parameter',
    '--name',
    parameter.parameterName,
    '--type',
    'String',
    '--value',
    parameter.outputValue,
    '--description',
    `GenU ${manifest.environmentName} CloudFormation output ${parameter.outputKey}`,
    '--overwrite',
    '--region',
    region,
  ]);

  runAws([
    'ssm',
    'add-tags-to-resource',
    '--resource-type',
    'Parameter',
    '--resource-id',
    parameter.parameterName,
    '--tags',
    `Key=Project,Value=GenU`,
    `Key=Environment,Value=${manifest.environmentName}`,
    `Key=SourceStack,Value=${stackName}`,
    `Key=ManagedBy,Value=generative-ai-use-cases-ci`,
    '--region',
    region,
  ]);

  console.log(`Put ${parameter.parameterName}`);
}

const summary = {
  environmentName: manifest.environmentName,
  stackName,
  region,
  parameterPrefix,
  dryRun,
  parameters: parameters.map((parameter) => ({
    outputKey: parameter.outputKey,
    parameterName: parameter.parameterName,
  })),
};

if (outputFile) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(summary, null, 2)}\n`);
}

console.log(
  `${dryRun ? 'Validated' : 'Exported'} ${parameters.length} CloudFormation outputs to ${parameterPrefix}.`
);

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const name = rawArgs[index];
    if (!name.startsWith('--')) {
      fail(`Unexpected argument: ${name}`);
    }

    const key = name.slice(2);
    if (key === 'dry-run') {
      parsed[key] = true;
      continue;
    }

    const value = rawArgs[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`Missing value for ${name}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function describeStackOutputs(name, awsRegion) {
  const result = runAws([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    name,
    '--region',
    awsRegion,
    '--output',
    'json',
  ]);

  const response = JSON.parse(result.stdout);
  return response.Stacks?.[0]?.Outputs ?? [];
}

function readOutputsFromFile(inputFile) {
  const payload = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload.Outputs)) {
    return payload.Outputs;
  }
  if (Array.isArray(payload.Stacks?.[0]?.Outputs)) {
    return payload.Stacks[0].Outputs;
  }
  fail(`${inputFile} does not contain CloudFormation Outputs.`);
}

function runAws(awsArgs) {
  const result = spawnSync('aws', awsArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const message = result.stderr.trim() || result.stdout.trim();
    throw new Error(message);
  }

  return result;
}

function fail(message, details = []) {
  console.error(message);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}
