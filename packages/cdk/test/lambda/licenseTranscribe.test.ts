/**
 * Transcribe metering — batch (chargeTranscribeJobOnce, charge-once marker in
 * a transaction) and realtime (reportRtSession, cumulative-report scheme).
 */
import {
  loadLicenseHarness,
  stubGetItems,
  baseItems,
  transactionCanceledError,
  LicenseHarness,
  TABLE_NAME,
  USER_ID,
  USER_PK,
} from './utils/licenseTestHarness';

describe('transcribe charging', () => {
  let h: LicenseHarness;

  beforeEach(async () => {
    h = await loadLicenseHarness();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const usageSk = () => `usage#${h.license.currentMonthKey()}`;

  const transactInputs = () =>
    h.ddbMock
      .commandCalls(h.lib.TransactWriteCommand)
      .map((c) => c.args[0].input);

  describe('chargeTranscribeJobOnce', () => {
    test('puts a charge marker and updates the ledger in one transaction', async () => {
      stubGetItems(h, baseItems());

      await h.license.chargeTranscribeJobOnce(USER_ID, 'job-1', 60);

      const inputs = transactInputs();
      expect(inputs).toHaveLength(1);
      const tx = inputs[0].TransactItems!;
      expect(tx).toHaveLength(2);

      const put = tx[0].Put!;
      expect(put.TableName).toBe(TABLE_NAME);
      expect(put.ConditionExpression).toBe('attribute_not_exists(sk)');
      expect(put.Item!.pk).toBe(USER_PK);
      expect(put.Item!.sk).toBe('charged#transcribe#job-1');
      expect(put.Item!.chargedSeconds).toBe(60);
      // 60s = 1min * 0.006 USD/min * 150 JPY/USD
      expect(put.Item!.chargedYen).toBeCloseTo(0.9, 9);

      const update = tx[1].Update!;
      expect(update.Key).toEqual({ pk: USER_PK, sk: usageSk() });
      expect(update.UpdateExpression).toContain(
        'ADD consumedYen :amount, #cat :amount'
      );
      expect(update.ExpressionAttributeNames!['#cat']).toBe('spent#transcribe');
      expect(update.ExpressionAttributeValues![':amount']).toBeCloseTo(0.9, 9);

      // The ledger write happens inside the transaction, not standalone
      expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(0);
    });

    test('bills at least minBillableSeconds (15s) for short jobs', async () => {
      stubGetItems(h, baseItems());

      await h.license.chargeTranscribeJobOnce(USER_ID, 'job-short', 5);

      const tx = transactInputs()[0].TransactItems!;
      expect(tx[0].Put!.Item!.chargedSeconds).toBe(15);
      // 15s = 0.25min * 0.006 USD/min * 150 JPY/USD
      expect(tx[1].Update!.ExpressionAttributeValues![':amount']).toBeCloseTo(
        0.225,
        9
      );
    });

    test('silently returns when the job was already charged', async () => {
      stubGetItems(h, baseItems());
      h.ddbMock
        .on(h.lib.TransactWriteCommand)
        .rejects(transactionCanceledError(['ConditionalCheckFailed', 'None']));

      await expect(
        h.license.chargeTranscribeJobOnce(USER_ID, 'job-1', 60)
      ).resolves.toBeUndefined();
    });

    test('rethrows transaction failures other than the charge marker conflict', async () => {
      stubGetItems(h, baseItems());
      h.ddbMock
        .on(h.lib.TransactWriteCommand)
        .rejects(transactionCanceledError(['None', 'TransactionConflict']));

      await expect(
        h.license.chargeTranscribeJobOnce(USER_ID, 'job-1', 60)
      ).rejects.toThrow();
    });

    test('throws when the fx rate is missing', async () => {
      const items = baseItems();
      delete items['config|fxRate'];
      stubGetItems(h, items);

      await expect(
        h.license.chargeTranscribeJobOnce(USER_ID, 'job-1', 60)
      ).rejects.toThrow(/fx rate/);
      expect(transactInputs()).toHaveLength(0);
    });
  });

  describe('reportRtSession', () => {
    const sessionSk = 'transcribe-rt#session-1';

    const withSession = (
      session: Record<string, unknown> | undefined
    ): Record<string, Record<string, unknown> | undefined> => {
      const items: Record<string, Record<string, unknown> | undefined> =
        baseItems();
      items[`${USER_PK}|${sessionSk}`] = session;
      return items;
    };

    test('charges only the delta above the already-charged seconds', async () => {
      stubGetItems(h, withSession({ chargedSeconds: 30, finalized: false }));

      await h.license.reportRtSession(USER_ID, 'session-1', 45, false);

      const inputs = transactInputs();
      expect(inputs).toHaveLength(1);
      const tx = inputs[0].TransactItems!;

      const sessionUpdate = tx[0].Update!;
      expect(sessionUpdate.Key).toEqual({ pk: USER_PK, sk: sessionSk });
      expect(sessionUpdate.ConditionExpression).toBe(
        'attribute_not_exists(chargedSeconds) OR chargedSeconds = :prev'
      );
      expect(sessionUpdate.ExpressionAttributeValues![':new']).toBe(45);
      expect(sessionUpdate.ExpressionAttributeValues![':prev']).toBe(30);
      expect(sessionUpdate.ExpressionAttributeValues![':finalized']).toBe(
        false
      );

      const ledgerUpdate = tx[1].Update!;
      expect(ledgerUpdate.Key).toEqual({ pk: USER_PK, sk: usageSk() });
      // 15s delta = 0.25min * 0.01 USD/min * 150 JPY/USD
      expect(ledgerUpdate.ExpressionAttributeValues![':amount']).toBeCloseTo(
        0.375,
        9
      );
    });

    test('a rewound cumulative report charges nothing and keeps chargedSeconds', async () => {
      stubGetItems(h, withSession({ chargedSeconds: 50, finalized: false }));

      await h.license.reportRtSession(USER_ID, 'session-1', 45, false);

      expect(transactInputs()).toHaveLength(0);
      expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(0);
    });

    test('the final report tops a short session up to the 15s minimum', async () => {
      stubGetItems(h, withSession({ chargedSeconds: 0, finalized: false }));

      await h.license.reportRtSession(USER_ID, 'session-1', 8, true);

      const tx = transactInputs()[0].TransactItems!;
      const sessionUpdate = tx[0].Update!;
      expect(sessionUpdate.ExpressionAttributeValues![':new']).toBe(15);
      expect(sessionUpdate.ExpressionAttributeValues![':finalized']).toBe(true);
      // Charged 15s in total: 0.25min * 0.01 USD/min * 150 JPY/USD
      expect(tx[1].Update!.ExpressionAttributeValues![':amount']).toBeCloseTo(
        0.375,
        9
      );
    });

    test('re-finalizing an already finalized session charges nothing', async () => {
      stubGetItems(h, withSession({ chargedSeconds: 20, finalized: true }));

      await h.license.reportRtSession(USER_ID, 'session-1', 20, true);

      expect(transactInputs()).toHaveLength(0);
      expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(0);
    });

    test('a final report with no new seconds marks finalized without a ledger write', async () => {
      stubGetItems(h, withSession({ chargedSeconds: 20, finalized: false }));

      await h.license.reportRtSession(USER_ID, 'session-1', 20, true);

      // No money to move -> plain session update instead of a transaction
      expect(transactInputs()).toHaveLength(0);
      const updates = h.ddbMock.commandCalls(h.lib.UpdateCommand);
      expect(updates).toHaveLength(1);
      const input = updates[0].args[0].input;
      expect(input.Key).toEqual({ pk: USER_PK, sk: sessionSk });
      expect(input.ExpressionAttributeValues![':finalized']).toBe(true);
      expect(input.ExpressionAttributeValues![':new']).toBe(20);
    });

    test('retries on an optimistic-lock conflict and succeeds', async () => {
      stubGetItems(h, withSession({ chargedSeconds: 30, finalized: false }));
      h.ddbMock
        .on(h.lib.TransactWriteCommand)
        .rejectsOnce(transactionCanceledError(['ConditionalCheckFailed']))
        .resolves({});

      await expect(
        h.license.reportRtSession(USER_ID, 'session-1', 45, false)
      ).resolves.toBeUndefined();

      expect(transactInputs()).toHaveLength(2);
    });

    test('throws when the fx rate is missing', async () => {
      const items = withSession({ chargedSeconds: 0, finalized: false });
      delete items['config|fxRate'];
      stubGetItems(h, items);

      await expect(
        h.license.reportRtSession(USER_ID, 'session-1', 30, false)
      ).rejects.toThrow(/fx rate/);
    });
  });
});
