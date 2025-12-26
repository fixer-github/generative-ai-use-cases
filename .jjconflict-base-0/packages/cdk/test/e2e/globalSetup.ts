/**
 * E2E Global Setup
 *
 * This runs ONCE before any test files are loaded.
 * Sets AWS_PROFILE and AWS_REGION so AWS SDK clients work correctly.
 * Returns a teardown function that runs after all tests complete.
 */

import * as fs from 'fs';
import * as path from 'path';
import globalTeardown from './globalTeardown';

const CDK_ROOT = path.join(__dirname, '..', '..');
const ENV_FILE = path.join(CDK_ROOT, '.env.e2e');
const DEFAULT_REGION = 'ap-northeast-1';

function loadEnvFile(): Record<string, string> {
  const config: Record<string, string> = {};

  if (!fs.existsSync(ENV_FILE)) {
    console.log('No .env.e2e found');
    return config;
  }

  const content = fs.readFileSync(ENV_FILE, 'utf-8');
  content.split('\n').forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (value) {
        config[key] = value;
      }
    }
  });

  return config;
}

export default function globalSetup(): () => Promise<void> {
  const envConfig = loadEnvFile();

  // Set AWS credentials config
  if (envConfig.AWS_PROFILE && !process.env.AWS_PROFILE) {
    process.env.AWS_PROFILE = envConfig.AWS_PROFILE;
  }

  if (envConfig.AWS_REGION) {
    process.env.AWS_REGION = envConfig.AWS_REGION;
  } else if (!process.env.AWS_REGION) {
    process.env.AWS_REGION = DEFAULT_REGION;
  }

  // Pre-set other env vars from .env.e2e
  for (const [key, value] of Object.entries(envConfig)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  console.log(`Global Setup: AWS_PROFILE=${process.env.AWS_PROFILE || '(default)'}, AWS_REGION=${process.env.AWS_REGION}`);

  // Return teardown function to be called after all tests complete
  return globalTeardown;
}
