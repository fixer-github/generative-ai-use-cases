import type { Container } from '@dagger.io/dagger';

export async function buildWeb(container: Container): Promise<Container> {
  console.log('🏗️  Building web application...');

  const result = container
    .withExec(['npm', 'run', 'web:build'])
    .withExec(['ls', '-la', 'packages/web/dist']);

  await result.sync();
  return result;
}

export async function buildCDK(container: Container): Promise<Container> {
  console.log('🏗️  Building CDK application...');

  // Note: lambda-build-dryrun (tsc --noEmit) is redundant since build (tsc) does full compilation
  const result = container.withExec([
    'npm',
    '-w',
    'packages/cdk',
    'run',
    'build',
  ]);

  await result.sync();
  return result;
}

export async function synthCDK(container: Container): Promise<Container> {
  console.log('📦 Synthesizing CDK stacks...');

  // Set required CDK environment variable
  const result = container
    .withEnvVariable('CDK_DEFAULT_ACCOUNT', '123456789012')
    .withExec(['npm', '-w', 'packages/cdk', 'run', 'cdk', 'synth'])
    .withExec(['ls', '-la', 'packages/cdk/cdk.out']);

  await result.sync();
  return result;
}

export async function buildExtension(container: Container): Promise<Container> {
  console.log('🧩 Building browser extension...');

  // Check if extension directory exists, then build
  const result = container.withExec([
    'sh',
    '-c',
    "[ -d browser-extension ] && npm run extension:build || echo 'Skipping extension build (directory not found)'",
  ]);

  await result.sync();
  return result;
}

export async function runBuild(container: Container): Promise<Container> {
  console.log('🚀 Running complete build pipeline...');

  // Run CDK and Web builds in parallel - they have no dependencies on each other
  const [cdkContainer, webContainer] = await Promise.all([
    buildCDK(container),
    buildWeb(container),
  ]);

  // Use the web container as the final result (both containers are from same base)
  // The actual build artifacts are validated within each build function
  void cdkContainer; // Suppress unused variable warning
  // buildContainer = await buildExtension(buildContainer); // Skipped: not needed currently
  // buildContainer = await synthCDK(buildContainer); // Skipped: requires AWS account config

  console.log('✅ Build completed successfully');
  return webContainer;
}
