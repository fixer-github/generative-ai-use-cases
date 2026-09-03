/**
 * chargeUsage() / chargeLlmUsage() / chargeLlmUsageSafely() — ledger writes
 * with atomic ADD, retry semantics and the never-throw wrapper.
 */
import {
  loadLicenseHarness,
  stubGetItems,
  baseItems,
  LicenseHarness,
  TABLE_NAME,
  USER_ID,
  USER_PK,
  SONNET_MODEL_ID,
} from './utils/licenseTestHarness';

jest.mock('../../lambda/utils/sendgrid', () => ({
  isSendGridConfigured: jest.fn(() => true),
  sendMail: jest.fn(async () => undefined),
}));

type SendgridMock = {
  isSendGridConfigured: jest.Mock;
  sendMail: jest.Mock;
};

describe('license charging', () => {
  let h: LicenseHarness;
  let sendgrid: SendgridMock;

  beforeEach(async () => {
    h = await loadLicenseHarness();
    // Must be imported from the same registry generation as the module
    // under test (the jest.mock factory re-runs per generation).
    sendgrid = (await import(
      '../../lambda/utils/sendgrid'
    )) as unknown as SendgridMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const usageSk = () => `usage#${h.license.currentMonthKey()}`;

  describe('chargeUsage', () => {
    test('adds the amount to consumedYen and the category bucket atomically', async () => {
      stubGetItems(h, baseItems());

      await h.license.chargeUsage(USER_ID, 12.5, 'chat');

      const calls = h.ddbMock.commandCalls(h.lib.UpdateCommand);
      expect(calls).toHaveLength(1);
      const input = calls[0].args[0].input;
      expect(input.TableName).toBe(TABLE_NAME);
      expect(input.Key).toEqual({ pk: USER_PK, sk: usageSk() });
      expect(input.UpdateExpression).toContain(
        'ADD consumedYen :amount, #cat :amount'
      );
      expect(input.ExpressionAttributeNames!['#cat']).toBe('spent#chat');
      expect(input.ExpressionAttributeValues![':amount']).toBe(12.5);
      // Allocation snapshot taken from the assigned plan
      expect(input.ExpressionAttributeValues![':allocation']).toBe(2000);
      expect(input.UpdateExpression).toContain(
        'allocationYen = if_not_exists(allocationYen, :allocation)'
      );
    });

    test.each([[0], [-5], [NaN]])(
      'writes nothing for a non-positive amount (%p)',
      async (amount) => {
        stubGetItems(h, baseItems());
        h.ddbMock.resetHistory();

        await h.license.chargeUsage(USER_ID, amount, 'chat');

        expect(h.ddbMock.calls()).toHaveLength(0);
      }
    );

    test('retries a failed write and succeeds on the third attempt', async () => {
      stubGetItems(h, baseItems());
      h.ddbMock
        .on(h.lib.UpdateCommand)
        .rejectsOnce(new Error('throttled 1'))
        .rejectsOnce(new Error('throttled 2'))
        .resolves({});

      await expect(
        h.license.chargeUsage(USER_ID, 1, 'chat')
      ).resolves.toBeUndefined();

      expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(3);
    });

    test('throws after three failed attempts', async () => {
      stubGetItems(h, baseItems());
      h.ddbMock.on(h.lib.UpdateCommand).rejects(new Error('always failing'));

      await expect(h.license.chargeUsage(USER_ID, 1, 'chat')).rejects.toThrow(
        'always failing'
      );

      expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(3);
    });
  });

  describe('chargeLlmUsage', () => {
    test('throws when no unit price is registered for the model', async () => {
      const items = baseItems();
      delete items['config|price#claude-sonnet-4-5'];
      stubGetItems(h, items);

      await expect(
        h.license.chargeLlmUsage(
          USER_ID,
          SONNET_MODEL_ID,
          { inputTokens: 100 },
          'chat'
        )
      ).rejects.toThrow(/no unit price/);
      expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(0);
    });

    test('throws when the fx rate is missing', async () => {
      const items = baseItems();
      delete items['config|fxRate'];
      stubGetItems(h, items);

      await expect(
        h.license.chargeLlmUsage(
          USER_ID,
          SONNET_MODEL_ID,
          { inputTokens: 100 },
          'chat'
        )
      ).rejects.toThrow(/fx rate/);
      expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(0);
    });

    test('charges tokens x unit price x rate, including cache buckets', async () => {
      stubGetItems(h, baseItems());

      await h.license.chargeLlmUsage(
        USER_ID,
        SONNET_MODEL_ID,
        {
          inputTokens: 1_000,
          outputTokens: 2_000,
          cacheReadInputTokens: 100_000,
          cacheWriteInputTokens: 50_000,
        },
        'generation'
      );

      const calls = h.ddbMock.commandCalls(h.lib.UpdateCommand);
      expect(calls).toHaveLength(1);
      const input = calls[0].args[0].input;
      expect(input.Key).toEqual({ pk: USER_PK, sk: usageSk() });
      expect(input.ExpressionAttributeNames!['#cat']).toBe('spent#generation');
      // (1000*3.3 + 2000*16.5 + 100000*0.33 + 50000*4.125) / 1e6 USD * 150
      expect(input.ExpressionAttributeValues![':amount']).toBeCloseTo(
        41.3325,
        6
      );
      expect(input.ExpressionAttributeValues![':allocation']).toBe(2000);
    });
  });

  describe('chargeLlmUsageSafely', () => {
    test('never throws; alerts the admin by mail when an address is set', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const items = baseItems();
      delete items['config|price#claude-sonnet-4-5']; // will fail to charge
      items['config|settings'] = {
        pk: 'config',
        sk: 'settings',
        adminAlertEmail: 'admin@example.com',
      };
      stubGetItems(h, items);

      await expect(
        h.license.chargeLlmUsageSafely(
          USER_ID,
          SONNET_MODEL_ID,
          { inputTokens: 100 },
          'chat'
        )
      ).resolves.toBeUndefined();

      expect(sendgrid.sendMail).toHaveBeenCalledTimes(1);
      expect(sendgrid.sendMail).toHaveBeenCalledWith(
        'admin@example.com',
        expect.any(String),
        expect.stringContaining(USER_ID)
      );
    });

    test('logs only (no mail) when no admin address is configured', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const items = baseItems();
      delete items['config|price#claude-sonnet-4-5'];
      stubGetItems(h, items); // settings item has no adminAlertEmail

      await expect(
        h.license.chargeLlmUsageSafely(
          USER_ID,
          SONNET_MODEL_ID,
          { inputTokens: 100 },
          'chat'
        )
      ).resolves.toBeUndefined();

      expect(sendgrid.sendMail).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    test('charges normally and does not alert on success', async () => {
      stubGetItems(h, baseItems());

      await h.license.chargeLlmUsageSafely(
        USER_ID,
        SONNET_MODEL_ID,
        { inputTokens: 1_000_000 },
        'chat'
      );

      const calls = h.ddbMock.commandCalls(h.lib.UpdateCommand);
      expect(calls).toHaveLength(1);
      // 1M input tokens * 3.3 USD/MTok * 150 JPY/USD
      expect(
        calls[0].args[0].input.ExpressionAttributeValues![':amount']
      ).toBeCloseTo(495, 6);
      expect(sendgrid.sendMail).not.toHaveBeenCalled();
    });
  });
});
