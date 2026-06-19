import fs from 'node:fs';
import path from 'node:path';
import { readCicdConfig } from './lib/cicd-config.mjs';

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));
const manifest = readCicdConfig({
  repoRoot,
  manifestPath: args.manifest,
});

const cdkJsonPath = path.resolve(
  repoRoot,
  args['cdk-json'] ?? 'packages/cdk/cdk.json'
);
const outputPath = path.resolve(repoRoot, args.output ?? cdkJsonPath);
const cdk = JSON.parse(fs.readFileSync(cdkJsonPath, 'utf8'));

const requiredContext = withoutUndefined({
  env: manifest.cdkEnv,
  modelRegion: manifest.modelRegion,
  agentCoreRegion: manifest.agentCoreRegion,
  agentCoreExternalRuntimes: manifest.agentCoreExternalRuntimes,
});

const generated = {
  ...cdk,
  context: {
    ...(cdk.context ?? {}),
    ...(manifest.cdkContext ?? {}),
    ...requiredContext,
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(generated, null, 2)}\n`);

console.log(
  `Materialized CDK context in ${path.relative(repoRoot, outputPath)}`
);

function withoutUndefined(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  );
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const name = rawArgs[index];
    if (!name.startsWith('--')) {
      fail(`Unexpected argument: ${name}`);
    }

    const key = name.slice(2);
    const value = rawArgs[index + 1];
    if (!value || value.startsWith('--')) {
      fail(`Missing value for ${name}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
