import { defineConfig } from 'vitest/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.e2e file before tests run
const envFile = path.join(__dirname, '.env.e2e');
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf-8');
  content.split('\n').forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Set default region if not set
if (!process.env.AWS_REGION) {
  process.env.AWS_REGION = 'ap-northeast-1';
}

export default defineConfig({
  test: {
    root: './test/e2e',
    environment: 'node',
    globals: true,
    include: ['**/*.e2e.test.ts'],
    setupFiles: ['./setup.ts'],
    globalSetup: ['./globalSetup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
