/**
 * seedLicenseData.handler — deploy-time seeding. Existing items are kept
 * (putIfAbsent), except the admin alert address which follows the cdk config
 * on every deploy.
 */
import { mockClient } from 'aws-sdk-client-mock';
import { MODEL_PRICES } from '../../lambda/utils/modelPrices';

jest.mock('../../lambda/updateFxRate', () => ({
  fetchUsdJpyRate: jest.fn(),
}));

type DdbLib = typeof import('@aws-sdk/lib-dynamodb');
type SeedModule = typeof import('../../lambda/seedLicenseData');
type FxMock = { fetchUsdJpyRate: jest.Mock };

const TABLE_NAME = 'license-test-table';

const HAIKU_ID = 'jp.anthropic.claude-haiku-4-5-20251001-v1:0';
const SONNET_ID = 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0';
const OPUS_ID = 'jp.anthropic.claude-opus-4-5-20251101-v1:0';

const loadHarness = async (opts: { adminEmail?: string } = {}) => {
  jest.resetModules();
  process.env.LICENSE_TABLE_NAME = TABLE_NAME;
  process.env.MODEL_IDS = JSON.stringify([
    { modelId: HAIKU_ID },
    { modelId: SONNET_ID },
    { modelId: OPUS_ID },
  ]);
  if (opts.adminEmail) {
    process.env.LICENSE_ADMIN_ALERT_EMAIL = opts.adminEmail;
  } else {
    delete process.env.LICENSE_ADMIN_ALERT_EMAIL;
  }
  delete process.env.INITIAL_FX_RATE; // default: 150
  const lib: DdbLib = await import('@aws-sdk/lib-dynamodb');
  const ddbMock = mockClient(lib.DynamoDBDocumentClient);
  ddbMock.onAnyCommand().resolves({});
  const fxMock = (await import(
    '../../lambda/updateFxRate'
  )) as unknown as FxMock;
  const seed: SeedModule = await import('../../lambda/seedLicenseData');
  return { lib, ddbMock, fxMock, seed };
};

type Harness = Awaited<ReturnType<typeof loadHarness>>;

const conditionalCheckFailedError = (): Error =>
  Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });

describe('seedLicenseData.handler', () => {
  let h: Harness;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const putInputs = () =>
    h.ddbMock.commandCalls(h.lib.PutCommand).map((c) => c.args[0].input);

  const putBySk = (sk: string) =>
    putInputs().find((input) => input.Item!.sk === sk);

  test('seeds plans, prices, settings and fx rate with put-if-absent', async () => {
    h = await loadHarness({ adminEmail: 'admin@example.com' });
    h.fxMock.fetchUsdJpyRate.mockResolvedValue(155);

    await h.seed.handler();

    // Every seed write is conditional on the item not existing yet
    for (const input of putInputs()) {
      expect(input.TableName).toBe(TABLE_NAME);
      expect(input.ConditionExpression).toBe('attribute_not_exists(pk)');
    }

    // Plans: light/standard get haiku+sonnet, premium adds opus
    expect(putBySk('plan#light')!.Item).toMatchObject({
      pk: 'plans',
      monthlyFeeYen: 3000,
      allocationYen: 750,
      allowedModelIds: [HAIKU_ID, SONNET_ID],
      enabled: true,
    });
    expect(putBySk('plan#standard')!.Item).toMatchObject({
      monthlyFeeYen: 5000,
      allocationYen: 2000,
      allowedModelIds: [HAIKU_ID, SONNET_ID],
    });
    expect(putBySk('plan#premium')!.Item).toMatchObject({
      monthlyFeeYen: 10000,
      allocationYen: 5000,
      allowedModelIds: [HAIKU_ID, SONNET_ID, OPUS_ID],
    });

    // One price item per entry of the price table
    for (const [key, price] of Object.entries(MODEL_PRICES)) {
      expect(putBySk(`price#${key}`)!.Item).toMatchObject({
        pk: 'config',
        ...price,
      });
    }

    // Settings carry the configured alert address
    expect(putBySk('settings')!.Item).toMatchObject({
      pk: 'config',
      adminAlertEmail: 'admin@example.com',
      minBillableSeconds: 15,
      fxMinJpyPerUsd: 120,
      fxMaxJpyPerUsd: 200,
    });

    // Initial fx rate comes from the live fetch when it is in range
    expect(putBySk('fxRate')!.Item).toMatchObject({
      pk: 'config',
      rateJpyPerUsd: 155,
      source: 'initial-live-fetch',
    });
  });

  test('does not throw when all items already exist', async () => {
    h = await loadHarness({ adminEmail: 'admin@example.com' });
    h.fxMock.fetchUsdJpyRate.mockResolvedValue(155);
    h.ddbMock.on(h.lib.PutCommand).rejects(conditionalCheckFailedError());

    await expect(h.seed.handler()).resolves.toBeUndefined();
  });

  test('rethrows non-conditional put failures', async () => {
    h = await loadHarness({ adminEmail: 'admin@example.com' });
    h.fxMock.fetchUsdJpyRate.mockResolvedValue(155);
    h.ddbMock.on(h.lib.PutCommand).rejects(new Error('ddb down'));

    await expect(h.seed.handler()).rejects.toThrow('ddb down');
  });

  test('overwrites adminAlertEmail on every run when configured', async () => {
    h = await loadHarness({ adminEmail: 'admin@example.com' });
    h.fxMock.fetchUsdJpyRate.mockResolvedValue(155);
    // Simulate an existing, previously-seeded table
    h.ddbMock.on(h.lib.PutCommand).rejects(conditionalCheckFailedError());

    await h.seed.handler();

    const updates = h.ddbMock.commandCalls(h.lib.UpdateCommand);
    expect(updates).toHaveLength(1);
    const input = updates[0].args[0].input;
    expect(input.Key).toEqual({ pk: 'config', sk: 'settings' });
    expect(input.UpdateExpression).toBe('SET adminAlertEmail = :email');
    expect(input.ExpressionAttributeValues![':email']).toBe(
      'admin@example.com'
    );
  });

  test('does not touch settings when no alert address is configured', async () => {
    h = await loadHarness();
    h.fxMock.fetchUsdJpyRate.mockResolvedValue(155);

    await h.seed.handler();

    expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(0);
    expect(putBySk('settings')!.Item!.adminAlertEmail).toBe('');
  });

  test('falls back to the default rate when the live rate is out of range', async () => {
    h = await loadHarness();
    h.fxMock.fetchUsdJpyRate.mockResolvedValue(250);

    await h.seed.handler();

    expect(putBySk('fxRate')!.Item).toMatchObject({
      rateJpyPerUsd: 150, // INITIAL_FX_RATE default
      source: 'initial-default',
    });
  });

  test('falls back to the default rate when the live fetch fails', async () => {
    h = await loadHarness();
    h.fxMock.fetchUsdJpyRate.mockRejectedValue(new Error('api down'));

    await h.seed.handler();

    expect(putBySk('fxRate')!.Item).toMatchObject({
      rateJpyPerUsd: 150,
      source: 'initial-default',
    });
  });
});
