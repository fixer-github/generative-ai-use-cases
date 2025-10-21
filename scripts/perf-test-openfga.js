/**
 * k6 Performance Test for OpenFGA
 *
 * Usage:
 *   k6 run --vus 10 --duration 30s scripts/perf-test-openfga.js
 *
 * Installation:
 *   brew install k6 (macOS)
 *   or visit: https://k6.io/docs/getting-started/installation/
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const checkLatency = new Trend('check_latency');
const p99Latency = new Trend('p99_latency');

// Configuration from environment variables
const OPENFGA_API_URL = __ENV.OPENFGA_API_URL || 'http://localhost:8080';
const OPENFGA_STORE_ID = __ENV.OPENFGA_STORE_ID;
const OPENFGA_API_TOKEN = __ENV.OPENFGA_API_TOKEN || '';

if (!OPENFGA_STORE_ID) {
  throw new Error('OPENFGA_STORE_ID environment variable is required');
}

const BASE_URL = `${OPENFGA_API_URL}/stores/${OPENFGA_STORE_ID}`;

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 VUs
    { duration: '1m', target: 10 },   // Stay at 10 VUs
    { duration: '30s', target: 50 },  // Ramp up to 50 VUs
    { duration: '1m', target: 50 },   // Stay at 50 VUs
    { duration: '30s', target: 100 }, // Ramp up to 100 VUs
    { duration: '1m', target: 100 },  // Stay at 100 VUs
    { duration: '30s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<100', 'p(99)<200'], // 95% < 100ms, 99% < 200ms
    errors: ['rate<0.01'],                          // Error rate < 1%
    checks: ['rate>0.95'],                          // Success rate > 95%
  },
};

// Headers
const headers = {
  'Content-Type': 'application/json',
};

if (OPENFGA_API_TOKEN) {
  headers['Authorization'] = `Bearer ${OPENFGA_API_TOKEN}`;
}

// Test scenarios
const scenarios = [
  // Scenario 1: Tenant membership check
  {
    name: 'Tenant membership',
    user: 'user:alice',
    relation: 'view',
    object: 'tenant:acme',
  },
  // Scenario 2: Conversation view
  {
    name: 'Conversation view',
    user: 'user:alice',
    relation: 'view',
    object: 'conversation:123',
  },
  // Scenario 3: Conversation edit
  {
    name: 'Conversation edit',
    user: 'user:alice',
    relation: 'edit',
    object: 'conversation:123',
  },
  // Scenario 4: Document upload check
  {
    name: 'Document upload',
    user: 'user:alice',
    relation: 'upload',
    object: 'document:new',
  },
  // Scenario 5: Usecase execution
  {
    name: 'Usecase execution',
    user: 'user:alice',
    relation: 'execute',
    object: 'usecase:chat',
  },
  // Scenario 6: Model execution
  {
    name: 'Model execution',
    user: 'user:alice',
    relation: 'execute',
    object: 'model:claude-3-sonnet',
  },
  // Scenario 7: Quota check
  {
    name: 'Quota check',
    user: 'user:alice',
    relation: 'execute',
    object: 'model_with_quota:claude-3-sonnet',
    context: {
      current_usage: 10,
      quota_limit: 50,
    },
  },
];

export default function () {
  // Randomly select a scenario
  const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];

  // Build request payload
  const payload = {
    user: scenario.user,
    relation: scenario.relation,
    object: scenario.object,
  };

  if (scenario.context) {
    payload.context = scenario.context;
  }

  // Make authorization check request
  const startTime = Date.now();

  const response = http.post(
    `${BASE_URL}/check`,
    JSON.stringify(payload),
    { headers }
  );

  const duration = Date.now() - startTime;

  // Record metrics
  checkLatency.add(duration);
  if (duration > 200) {
    p99Latency.add(duration);
  }

  // Validate response
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response has allowed field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return 'allowed' in body;
      } catch (e) {
        return false;
      }
    },
    'latency < 100ms': (r) => r.timings.duration < 100,
  });

  if (!success) {
    errorRate.add(1);
    console.error(`Failed check for ${scenario.name}:`, response.status, response.body);
  } else {
    errorRate.add(0);
  }

  // Slight delay to simulate realistic usage
  sleep(Math.random() * 0.5);
}

// Setup function - run once before all VUs start
export function setup() {
  console.log('===========================================');
  console.log('OpenFGA Performance Test');
  console.log('===========================================');
  console.log(`API URL: ${OPENFGA_API_URL}`);
  console.log(`Store ID: ${OPENFGA_STORE_ID}`);
  console.log('');
  console.log('Test Configuration:');
  console.log('- Stages: 30s → 10 VUs, 1m @ 10 VUs, 30s → 50 VUs, 1m @ 50 VUs, 30s → 100 VUs, 1m @ 100 VUs');
  console.log('- Thresholds: P95 < 100ms, P99 < 200ms, Error < 1%');
  console.log('');

  // Verify OpenFGA is accessible
  const response = http.get(`${OPENFGA_API_URL}/healthz`);

  if (response.status !== 200) {
    throw new Error(`OpenFGA health check failed: ${response.status}`);
  }

  console.log('✓ OpenFGA is healthy');
  console.log('');

  return { setupTime: Date.now() };
}

// Teardown function - run once after all VUs finish
export function teardown(data) {
  const duration = (Date.now() - data.setupTime) / 1000;

  console.log('');
  console.log('===========================================');
  console.log('Test Completed');
  console.log('===========================================');
  console.log(`Total duration: ${duration.toFixed(2)}s`);
  console.log('');
  console.log('Check detailed metrics above for:');
  console.log('- http_req_duration (latency percentiles)');
  console.log('- check_latency (custom metric)');
  console.log('- errors (error rate)');
  console.log('');
}
