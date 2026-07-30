/**
 * getLicenseStatus() — percentage-only status accessor (requirement 23).
 */
import {
  loadLicenseHarness,
  stubGetItems,
  baseItems,
  LicenseHarness,
  USER_ID,
  USER_PK,
  SONNET_MODEL_ID,
} from './utils/licenseTestHarness';

describe('getLicenseStatus', () => {
  let h: LicenseHarness;

  beforeEach(async () => {
    h = await loadLicenseHarness();
  });

  const usageSk = () => `usage#${h.license.currentMonthKey()}`;

  test('reports remaining percent and per-category breakdown from the ledger', async () => {
    const items = baseItems();
    items[`${USER_PK}|${usageSk()}`] = {
      allocationYen: 2000,
      consumedYen: 500,
      'spent#chat': 300,
      'spent#translate': 200,
      // zero-spend buckets must not appear in the breakdown
      'spent#summarize': 0,
    };
    stubGetItems(h, items);

    const status = await h.license.getLicenseStatus(USER_ID);

    expect(status.assigned).toBe(true);
    expect(status.planId).toBe('standard');
    expect(status.planName).toBe('Standard');
    expect(status.allowedModelIds).toEqual([SONNET_MODEL_ID]);
    expect(status.remainingPercent).toBe(75);
    expect(status.breakdown).toEqual([
      { category: 'chat', percent: 15 },
      { category: 'translate', percent: 10 },
    ]);
    expect(status.resetDate).toBe(h.license.nextResetDate());
    // default thresholds from settings
    expect(status.warnThresholdPercent).toBe(30);
    expect(status.criticalThresholdPercent).toBe(10);
  });

  test('rounds the remaining percent to one decimal place', async () => {
    const items = baseItems();
    items[`${USER_PK}|${usageSk()}`] = {
      allocationYen: 3000,
      consumedYen: 1000,
    };
    stubGetItems(h, items);

    const status = await h.license.getLicenseStatus(USER_ID);

    // (1 - 1000/3000) * 100 = 66.666... -> 66.7
    expect(status.remainingPercent).toBe(66.7);
  });

  test('clamps a negative remaining balance to 0 percent', async () => {
    const items = baseItems();
    items[`${USER_PK}|${usageSk()}`] = {
      allocationYen: 2000,
      consumedYen: 2500,
    };
    stubGetItems(h, items);

    const status = await h.license.getLicenseStatus(USER_ID);

    expect(status.remainingPercent).toBe(0);
  });

  test('prefers the ledger allocation snapshot over the current plan value', async () => {
    const items = baseItems();
    // The plan was upgraded mid-month...
    items['plans|plan#standard'] = {
      ...items['plans|plan#standard'],
      allocationYen: 5000,
    };
    // ...but this month's ledger was opened under the old 2000 JPY allocation
    items[`${USER_PK}|${usageSk()}`] = {
      allocationYen: 2000,
      consumedYen: 1000,
    };
    stubGetItems(h, items);

    const status = await h.license.getLicenseStatus(USER_ID);

    expect(status.remainingPercent).toBe(50); // not 80
  });

  test('shows 100 percent remaining when the month has no ledger yet', async () => {
    stubGetItems(h, baseItems()); // no usage item

    const status = await h.license.getLicenseStatus(USER_ID);

    expect(status.remainingPercent).toBe(100);
    expect(status.breakdown).toEqual([]);
  });

  test('reports unassigned users with 0 percent remaining', async () => {
    const items = baseItems();
    delete items[`${USER_PK}|assignment`];
    stubGetItems(h, items);

    const status = await h.license.getLicenseStatus(USER_ID);

    expect(status.assigned).toBe(false);
    expect(status.planId).toBeNull();
    expect(status.remainingPercent).toBe(0);
    expect(status.breakdown).toEqual([]);
  });

  test('reports a disabled plan as not usable (assigned: false)', async () => {
    const items = baseItems();
    items['plans|plan#standard'] = {
      ...items['plans|plan#standard'],
      enabled: false,
    };
    stubGetItems(h, items);

    const status = await h.license.getLicenseStatus(USER_ID);

    expect(status.assigned).toBe(false);
    expect(status.planId).toBe('standard');
    expect(status.planName).toBe('Standard');
    expect(status.remainingPercent).toBe(0);
  });
});
