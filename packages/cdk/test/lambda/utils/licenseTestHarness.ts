/**
 * Shared harness for license-related lambda unit tests.
 *
 * lambda/utils/license.ts reads LICENSE_TABLE_NAME at module load time and
 * keeps a 60-second config cache in module scope, so every test loads a fresh
 * copy of the module via jest.resetModules() + dynamic import (which ts-jest
 * compiles down to a registry-aware require).
 *
 * The DynamoDBDocumentClient class passed to aws-sdk-client-mock must come
 * from the same (fresh) module registry generation as the module under test:
 * mockClient() stubs the class prototype and .on() matches commands with
 * instanceof, both of which break across registry generations. Hence the
 * harness re-imports @aws-sdk/lib-dynamodb after each reset and hands the
 * fresh command classes back to the test.
 */
import { mockClient } from 'aws-sdk-client-mock';
import type { GetCommandInput } from '@aws-sdk/lib-dynamodb';

export const TABLE_NAME = 'license-test-table';

export const USER_ID = 'test-user';
export const USER_PK = `user#${USER_ID}`;

export const SONNET_MODEL_ID = 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0';
export const OPUS_MODEL_ID = 'jp.anthropic.claude-opus-4-5-20251101-v1:0';

export const SONNET_PRICE = {
  inputUsdPerMTok: 3.3,
  outputUsdPerMTok: 16.5,
  cacheReadUsdPerMTok: 0.33,
  cacheWriteUsdPerMTok: 4.125,
};

export type DdbLib = typeof import('@aws-sdk/lib-dynamodb');
export type LicenseModule = typeof import('../../../lambda/utils/license');

const createDocClientMock = (lib: DdbLib) =>
  mockClient(lib.DynamoDBDocumentClient);
export type DdbMock = ReturnType<typeof createDocClientMock>;

export type LicenseHarness = {
  lib: DdbLib;
  ddbMock: DdbMock;
  license: LicenseModule;
};

export const loadLicenseHarness = async (): Promise<LicenseHarness> => {
  jest.resetModules();
  process.env.LICENSE_TABLE_NAME = TABLE_NAME;
  const lib: DdbLib = await import('@aws-sdk/lib-dynamodb');
  const ddbMock = createDocClientMock(lib);
  // Generic default first; later (more specific) registrations take
  // precedence for sinon withArgs ties.
  ddbMock.onAnyCommand().resolves({});
  const license: LicenseModule = await import('../../../lambda/utils/license');
  return { lib, ddbMock, license };
};

/**
 * Routes GetCommand responses by '<pk>|<sk>'. Keys not present in the map
 * resolve to an empty response (Item: undefined).
 */
export const stubGetItems = (
  harness: Pick<LicenseHarness, 'lib' | 'ddbMock'>,
  items: Record<string, Record<string, unknown> | undefined>
): void => {
  harness.ddbMock.on(harness.lib.GetCommand).callsFake((input) => {
    const key = (input as GetCommandInput).Key as { pk: string; sk: string };
    return { Item: items[`${key.pk}|${key.sk}`] };
  });
};

/**
 * A minimal consistent data set: one user assigned to an enabled 'standard'
 * plan (2,000 JPY allocation), a 150 JPY/USD fx rate, default settings and a
 * unit price for the Sonnet model. Tests mutate copies of this as needed.
 */
export const baseItems = (): Record<string, Record<string, unknown>> => ({
  [`${USER_PK}|assignment`]: { planId: 'standard' },
  'plans|plan#standard': {
    pk: 'plans',
    sk: 'plan#standard',
    name: 'Standard',
    monthlyFeeYen: 5000,
    allocationYen: 2000,
    allowedModelIds: [SONNET_MODEL_ID],
    enabled: true,
  },
  'config|fxRate': {
    pk: 'config',
    sk: 'fxRate',
    rateJpyPerUsd: 150,
    updatedDate: '2026-07-30',
    source: 'test',
  },
  'config|settings': { pk: 'config', sk: 'settings' },
  'config|price#claude-sonnet-4-5': {
    pk: 'config',
    sk: 'price#claude-sonnet-4-5',
    ...SONNET_PRICE,
  },
});

export const conditionalCheckFailedError = (): Error =>
  Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });

export const transactionCanceledError = (codes: string[]): Error =>
  Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
