/**
 * checkLicense() — the fail-closed entry gate (design doc ch.2).
 */
import {
  loadLicenseHarness,
  stubGetItems,
  baseItems,
  LicenseHarness,
  USER_ID,
  USER_PK,
  SONNET_MODEL_ID,
  OPUS_MODEL_ID,
} from './utils/licenseTestHarness';

describe('checkLicense', () => {
  let h: LicenseHarness;

  beforeEach(async () => {
    h = await loadLicenseHarness();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const usageSk = () => `usage#${h.license.currentMonthKey()}`;

  test('returns unassigned when no assignment item exists', async () => {
    const items = baseItems();
    delete items[`${USER_PK}|assignment`];
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'unassigned' });
  });

  test('returns unassigned when the assignment has no planId', async () => {
    const items = baseItems();
    items[`${USER_PK}|assignment`] = { planId: null };
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'unassigned' });
  });

  test('returns unassigned when the assigned plan does not exist', async () => {
    const items = baseItems();
    delete items['plans|plan#standard'];
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'unassigned' });
  });

  test('returns unassigned when the assigned plan is disabled', async () => {
    const items = baseItems();
    items['plans|plan#standard'] = {
      ...items['plans|plan#standard'],
      enabled: false,
    };
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'unassigned' });
  });

  test('returns model_not_allowed for a model outside the plan', async () => {
    stubGetItems(h, baseItems());

    await expect(
      h.license.checkLicense(USER_ID, { modelId: OPUS_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'model_not_allowed' });
  });

  test('returns price_unavailable when the fx rate is missing', async () => {
    const items = baseItems();
    delete items['config|fxRate'];
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'price_unavailable' });
  });

  test('returns price_unavailable when the model has no unit price', async () => {
    const items = baseItems();
    // Allow the model on the plan, but register no price for it
    items['plans|plan#standard'] = {
      ...items['plans|plan#standard'],
      allowedModelIds: [SONNET_MODEL_ID, OPUS_MODEL_ID],
    };
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: OPUS_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'price_unavailable' });
  });

  test('allows a priced model even when another model has no price', async () => {
    const items = baseItems();
    items['plans|plan#standard'] = {
      ...items['plans|plan#standard'],
      allowedModelIds: [SONNET_MODEL_ID, OPUS_MODEL_ID],
    };
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: true });
  });

  test('allows when there is no ledger for the current month', async () => {
    stubGetItems(h, baseItems()); // no usage item

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: true });
  });

  test('allows a check without modelId when assignment and fx exist', async () => {
    stubGetItems(h, baseItems());

    await expect(h.license.checkLicense(USER_ID)).resolves.toEqual({
      allowed: true,
    });
  });

  test('returns exhausted when consumption equals the allocation', async () => {
    const items = baseItems();
    items[`${USER_PK}|${usageSk()}`] = {
      allocationYen: 2000,
      consumedYen: 2000,
    };
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'exhausted' });
  });

  test('returns exhausted when consumption exceeds the allocation', async () => {
    const items = baseItems();
    items[`${USER_PK}|${usageSk()}`] = {
      allocationYen: 2000,
      consumedYen: 2500.5,
    };
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'exhausted' });
  });

  test('allows while consumption is below the allocation', async () => {
    const items = baseItems();
    items[`${USER_PK}|${usageSk()}`] = {
      allocationYen: 2000,
      consumedYen: 1999.99,
    };
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: true });
  });

  test('uses the ledger allocation snapshot over the current plan value', async () => {
    const items = baseItems();
    // Plan says 2000, but this month started under a 100 JPY snapshot
    items[`${USER_PK}|${usageSk()}`] = {
      allocationYen: 100,
      consumedYen: 150,
    };
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'exhausted' });
  });

  test('returns exhausted when the plan allocation is zero', async () => {
    const items = baseItems();
    items['plans|plan#standard'] = {
      ...items['plans|plan#standard'],
      allocationYen: 0,
    };
    stubGetItems(h, items);

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'exhausted' });
  });

  test('fails closed with reason error when DynamoDB is unavailable', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    h.ddbMock.on(h.lib.GetCommand).rejects(new Error('ddb down'));

    await expect(
      h.license.checkLicense(USER_ID, { modelId: SONNET_MODEL_ID })
    ).resolves.toEqual({ allowed: false, reason: 'error' });
  });
});
