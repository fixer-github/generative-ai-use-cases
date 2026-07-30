/* eslint-disable i18nhelper/no-jp-string */
/**
 * One-shot seeding of the license table, run as a deploy-time trigger.
 *
 * Seeds (only when the item does not exist yet, so manual edits survive):
 *   - the 3 initial plans (requirement 5-7)
 *   - model unit prices (JP region = Anthropic list price x 1.1, requirement 16)
 *   - license settings (thresholds, Transcribe unit prices, alert address)
 *   - an initial fx rate (fetched live when possible; design doc ch.6, v4)
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { fetchUsdJpyRate } from './updateFxRate';
import { DEFAULT_LICENSE_SETTINGS } from './utils/license';

const LICENSE_TABLE_NAME = process.env.LICENSE_TABLE_NAME!;
const MODEL_IDS: { modelId: string }[] = JSON.parse(
  process.env.MODEL_IDS ?? '[]'
);
const ADMIN_ALERT_EMAIL = process.env.LICENSE_ADMIN_ALERT_EMAIL ?? '';
const INITIAL_FX_RATE = Number(process.env.INITIAL_FX_RATE ?? '150');

const dynamoDbDocument = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// JP-region (jp.) unit prices in USD per 1M tokens = Anthropic list x 1.1.
// Keyed by normalized model name (see normalizeModelKey in utils/license.ts).
const MODEL_PRICES: Record<
  string,
  {
    inputUsdPerMTok: number;
    outputUsdPerMTok: number;
    cacheReadUsdPerMTok: number;
    cacheWriteUsdPerMTok: number;
  }
> = {
  'claude-haiku-4-5': {
    inputUsdPerMTok: 1.1,
    outputUsdPerMTok: 5.5,
    cacheReadUsdPerMTok: 0.11,
    cacheWriteUsdPerMTok: 1.375,
  },
  'claude-sonnet-4-5': {
    inputUsdPerMTok: 3.3,
    outputUsdPerMTok: 16.5,
    cacheReadUsdPerMTok: 0.33,
    cacheWriteUsdPerMTok: 4.125,
  },
  'claude-opus-4-5': {
    inputUsdPerMTok: 5.5,
    outputUsdPerMTok: 27.5,
    cacheReadUsdPerMTok: 0.55,
    cacheWriteUsdPerMTok: 6.875,
  },
};

const putIfAbsent = async (item: Record<string, unknown>): Promise<void> => {
  try {
    await dynamoDbDocument.send(
      new PutCommand({
        TableName: LICENSE_TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );
    console.log(`[license] seeded ${item.pk}/${item.sk}`);
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      return; // already present — keep the existing (possibly edited) item
    }
    throw e;
  }
};

// Classify the deployed text models into plan tiers by model family.
const modelIdsFor = (families: string[]): string[] =>
  MODEL_IDS.map((m) => m.modelId).filter((id) =>
    families.some((f) => id.includes(f))
  );

export const handler = async (): Promise<void> => {
  const now = new Date().toISOString();

  // Plans (requirement 5-7): light 3,000 JPY / 750 JPY allocation,
  // standard 5,000 / 2,000, premium 10,000 / 5,000. Light and standard may
  // use Haiku + Sonnet; premium adds Opus.
  const plans = [
    {
      planId: 'light',
      name: 'ライト',
      monthlyFeeYen: 3000,
      allocationYen: 750,
      allowedModelIds: modelIdsFor(['haiku', 'sonnet']),
    },
    {
      planId: 'standard',
      name: '標準',
      monthlyFeeYen: 5000,
      allocationYen: 2000,
      allowedModelIds: modelIdsFor(['haiku', 'sonnet']),
    },
    {
      planId: 'premium',
      name: 'プレミアム',
      monthlyFeeYen: 10000,
      allocationYen: 5000,
      allowedModelIds: modelIdsFor(['haiku', 'sonnet', 'opus']),
    },
  ];
  for (const plan of plans) {
    await putIfAbsent({
      pk: 'plans',
      sk: `plan#${plan.planId}`,
      name: plan.name,
      monthlyFeeYen: plan.monthlyFeeYen,
      allocationYen: plan.allocationYen,
      allowedModelIds: plan.allowedModelIds,
      enabled: true,
      createdDate: now,
      updatedDate: now,
    });
  }

  // Model unit prices
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    await putIfAbsent({ pk: 'config', sk: `price#${key}`, ...price });
  }

  // Settings
  await putIfAbsent({
    pk: 'config',
    sk: 'settings',
    ...DEFAULT_LICENSE_SETTINGS,
    adminAlertEmail: ADMIN_ALERT_EMAIL,
  });

  // Initial fx rate: try a live fetch first, fall back to a fixed default.
  // The daily updater overwrites this from the next scheduled run onwards.
  let rate = INITIAL_FX_RATE;
  let source = 'initial-default';
  try {
    rate = await fetchUsdJpyRate();
    source = 'initial-live-fetch';
  } catch (e) {
    console.warn('[license] initial live fx fetch failed, using default', e);
  }
  await putIfAbsent({
    pk: 'config',
    sk: 'fxRate',
    rateJpyPerUsd: rate,
    updatedDate: now,
    source,
  });
};
