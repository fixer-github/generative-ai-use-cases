/**
 * getAssignment() — lazy application of a pending plan change on the first
 * read of a new month (design doc ch.8).
 */
import {
  loadLicenseHarness,
  stubGetItems,
  conditionalCheckFailedError,
  LicenseHarness,
  TABLE_NAME,
  USER_ID,
  USER_PK,
} from './utils/licenseTestHarness';

describe('getAssignment', () => {
  let h: LicenseHarness;

  beforeEach(async () => {
    h = await loadLicenseHarness();
  });

  const assignmentKey = { pk: USER_PK, sk: 'assignment' };

  test('applies a pending plan whose start month has been reached', async () => {
    stubGetItems(h, {
      [`${USER_PK}|assignment`]: {
        planId: 'light',
        pendingPlanId: 'standard',
        pendingFromMonth: h.license.currentMonthKey(), // boundary: <= now
      },
    });

    const result = await h.license.getAssignment(USER_ID);

    expect(result?.planId).toBe('standard');
    expect(result?.pendingPlanId).toBeUndefined();

    const updates = h.ddbMock.commandCalls(h.lib.UpdateCommand);
    expect(updates).toHaveLength(1);
    const input = updates[0].args[0].input;
    expect(input.TableName).toBe(TABLE_NAME);
    expect(input.Key).toEqual(assignmentKey);
    expect(input.UpdateExpression).toContain('SET planId = :newPlan');
    expect(input.UpdateExpression).toContain(
      'REMOVE pendingPlanId, pendingFromMonth'
    );
    expect(input.ConditionExpression).toBe('pendingPlanId = :expected');
    expect(input.ExpressionAttributeValues![':newPlan']).toBe('standard');
    expect(input.ExpressionAttributeValues![':expected']).toBe('standard');
  });

  test('applies a pending plan from a past month', async () => {
    stubGetItems(h, {
      [`${USER_PK}|assignment`]: {
        planId: 'light',
        pendingPlanId: 'premium',
        pendingFromMonth: '2000-01',
      },
    });

    const result = await h.license.getAssignment(USER_ID);

    expect(result?.planId).toBe('premium');
    expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(1);
  });

  test('returns the re-read state after losing the apply race', async () => {
    const pendingItem = {
      planId: 'light',
      pendingPlanId: 'standard',
      pendingFromMonth: '2000-01',
    };
    const settledItem = { planId: 'standard', assignedBy: 'other-applier' };
    h.ddbMock
      .on(h.lib.GetCommand)
      .resolvesOnce({ Item: pendingItem })
      .resolves({ Item: settledItem });
    h.ddbMock.on(h.lib.UpdateCommand).rejects(conditionalCheckFailedError());

    const result = await h.license.getAssignment(USER_ID);

    expect(result).toEqual(settledItem);
    expect(h.ddbMock.commandCalls(h.lib.GetCommand)).toHaveLength(2);
  });

  test('propagates non-conditional update failures', async () => {
    stubGetItems(h, {
      [`${USER_PK}|assignment`]: {
        planId: 'light',
        pendingPlanId: 'standard',
        pendingFromMonth: '2000-01',
      },
    });
    h.ddbMock.on(h.lib.UpdateCommand).rejects(new Error('ddb down'));

    await expect(h.license.getAssignment(USER_ID)).rejects.toThrow('ddb down');
  });

  test('keeps the current plan while the pending month is in the future', async () => {
    const raw = {
      planId: 'light',
      pendingPlanId: 'standard',
      pendingFromMonth: '2999-01',
    };
    stubGetItems(h, { [`${USER_PK}|assignment`]: raw });

    const result = await h.license.getAssignment(USER_ID);

    expect(result).toEqual(raw);
    expect(h.ddbMock.commandCalls(h.lib.UpdateCommand)).toHaveLength(0);
  });

  test('returns undefined when the user has no assignment item', async () => {
    stubGetItems(h, {});

    await expect(h.license.getAssignment(USER_ID)).resolves.toBeUndefined();
  });
});
