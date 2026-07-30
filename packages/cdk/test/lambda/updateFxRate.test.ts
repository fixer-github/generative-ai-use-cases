/**
 * updateFxRate.handler — daily USD/JPY refresh with a sanity range.
 * Out-of-range and failed fetches keep the previous rate and alert the admin.
 */
import { mockClient } from 'aws-sdk-client-mock';

jest.mock('../../lambda/utils/license', () => ({
  alertAdmin: jest.fn(async () => undefined),
  getLicenseSettings: jest.fn(),
}));

type DdbLib = typeof import('@aws-sdk/lib-dynamodb');
type FxModule = typeof import('../../lambda/updateFxRate');
type LicenseMock = { alertAdmin: jest.Mock; getLicenseSettings: jest.Mock };

const TABLE_NAME = 'license-test-table';

const loadHarness = async () => {
  jest.resetModules();
  process.env.LICENSE_TABLE_NAME = TABLE_NAME;
  delete process.env.FX_API_URL;
  const lib: DdbLib = await import('@aws-sdk/lib-dynamodb');
  const ddbMock = mockClient(lib.DynamoDBDocumentClient);
  ddbMock.onAnyCommand().resolves({});
  const licenseMock = (await import(
    '../../lambda/utils/license'
  )) as unknown as LicenseMock;
  licenseMock.getLicenseSettings.mockResolvedValue({
    fxMinJpyPerUsd: 120,
    fxMaxJpyPerUsd: 200,
  });
  const fxModule: FxModule = await import('../../lambda/updateFxRate');
  return { lib, ddbMock, licenseMock, fxModule };
};

type Harness = Awaited<ReturnType<typeof loadHarness>>;

const fxApiResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    json: async () => body,
  }) as unknown as Response;

describe('updateFxRate.handler', () => {
  let h: Harness;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    h = await loadHarness();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  const putCalls = () =>
    h.ddbMock.commandCalls(h.lib.PutCommand).map((c) => c.args[0].input);

  test('stores an in-range rate along with the previous one', async () => {
    fetchMock.mockResolvedValue(fxApiResponse({ rates: { JPY: 150 } }));
    h.ddbMock
      .on(h.lib.GetCommand, {
        TableName: TABLE_NAME,
        Key: { pk: 'config', sk: 'fxRate' },
      })
      .resolves({ Item: { rateJpyPerUsd: 148 } });

    await h.fxModule.handler();

    const puts = putCalls();
    expect(puts).toHaveLength(1);
    expect(puts[0].Item).toMatchObject({
      pk: 'config',
      sk: 'fxRate',
      rateJpyPerUsd: 150,
      previousRateJpyPerUsd: 148,
    });
    expect(h.licenseMock.alertAdmin).not.toHaveBeenCalled();
  });

  test.each([[119.9], [200.1]])(
    'rejects an out-of-range rate (%p), keeps the previous one and alerts',
    async (rate) => {
      fetchMock.mockResolvedValue(fxApiResponse({ rates: { JPY: rate } }));

      await h.fxModule.handler();

      expect(putCalls()).toHaveLength(0);
      expect(h.licenseMock.alertAdmin).toHaveBeenCalledTimes(1);
    }
  );

  test.each([[120], [200]])(
    'adopts a rate exactly on the range boundary (%p)',
    async (rate) => {
      fetchMock.mockResolvedValue(fxApiResponse({ rates: { JPY: rate } }));

      await h.fxModule.handler();

      const puts = putCalls();
      expect(puts).toHaveLength(1);
      expect(puts[0].Item!.rateJpyPerUsd).toBe(rate);
      expect(h.licenseMock.alertAdmin).not.toHaveBeenCalled();
    }
  );

  test('keeps the previous rate and alerts when the API returns an error status', async () => {
    fetchMock.mockResolvedValue(fxApiResponse({}, false, 502));

    await h.fxModule.handler();

    expect(putCalls()).toHaveLength(0);
    expect(h.licenseMock.alertAdmin).toHaveBeenCalledTimes(1);
  });

  test.each([[{ rates: {} }], [{ rates: { JPY: 'not-a-number' } }], [{}]])(
    'keeps the previous rate and alerts on an invalid payload (%p)',
    async (payload) => {
      fetchMock.mockResolvedValue(fxApiResponse(payload));

      await h.fxModule.handler();

      expect(putCalls()).toHaveLength(0);
      expect(h.licenseMock.alertAdmin).toHaveBeenCalledTimes(1);
    }
  );

  test('keeps the previous rate and alerts when the fetch itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('network unreachable'));

    await expect(h.fxModule.handler()).resolves.toBeUndefined();

    expect(putCalls()).toHaveLength(0);
    expect(h.licenseMock.alertAdmin).toHaveBeenCalledTimes(1);
  });
});
