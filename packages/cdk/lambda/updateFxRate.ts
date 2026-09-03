/* eslint-disable i18nhelper/no-jp-string */
/**
 * Daily USD/JPY rate refresh (requirement 17).
 *
 * Fetches the latest rate from a public FX API (default: Frankfurter, ECB
 * reference rates, no API key required) and stores it in the license table.
 * On failure the previous rate simply stays in place (design doc ch.6).
 * A fetched rate outside the sanity range (settings fxMinJpyPerUsd /
 * fxMaxJpyPerUsd, default 120-200 JPY) is treated the same as a failure:
 * rejected, previous rate kept, admin alerted (review 2026-07-30, decision:
 * reject-and-alert rather than adopt-and-alert).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { alertAdmin, getLicenseSettings } from './utils/license';

const LICENSE_TABLE_NAME = process.env.LICENSE_TABLE_NAME!;
const FX_API_URL =
  process.env.FX_API_URL ||
  'https://api.frankfurter.app/latest?from=USD&to=JPY';

const dynamoDbDocument = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const fetchUsdJpyRate = async (): Promise<number> => {
  const res = await fetch(FX_API_URL);
  if (!res.ok) {
    throw new Error(`FX API returned ${res.status}`);
  }
  const data = (await res.json()) as { rates?: { JPY?: number } };
  const rate = data.rates?.JPY;
  if (typeof rate !== 'number' || !(rate > 0)) {
    throw new Error(`FX API returned an invalid rate: ${JSON.stringify(data)}`);
  }
  return rate;
};

export const handler = async (): Promise<void> => {
  try {
    const rate = await fetchUsdJpyRate();

    const { fxMinJpyPerUsd, fxMaxJpyPerUsd } = await getLicenseSettings();
    if (rate < fxMinJpyPerUsd || rate > fxMaxJpyPerUsd) {
      console.error(
        `[license] fx rate ${rate} is outside the sanity range ` +
          `${fxMinJpyPerUsd}-${fxMaxJpyPerUsd}; keeping the previous rate`
      );
      await alertAdmin(
        '【GenU版GaiXer】為替レートが想定レンジ外のため採用しませんでした',
        `取得した為替レート(1 USD = ${rate} 円)が想定レンジ(${fxMinJpyPerUsd}〜${fxMaxJpyPerUsd}円)の外でした。\n` +
          `このレートは採用せず、前回取得済みのレートを使い続けます。\n\n` +
          `実勢レートが本当にレンジ外に達している場合は、ライセンステーブルの設定` +
          `(config/settings の fxMinJpyPerUsd / fxMaxJpyPerUsd)を見直してください。\n` +
          `取得元: ${FX_API_URL}`
      );
      return;
    }

    const existing = await dynamoDbDocument.send(
      new GetCommand({
        TableName: LICENSE_TABLE_NAME,
        Key: { pk: 'config', sk: 'fxRate' },
      })
    );

    await dynamoDbDocument.send(
      new PutCommand({
        TableName: LICENSE_TABLE_NAME,
        Item: {
          pk: 'config',
          sk: 'fxRate',
          rateJpyPerUsd: rate,
          previousRateJpyPerUsd: existing.Item?.rateJpyPerUsd,
          updatedDate: new Date().toISOString(),
          source: FX_API_URL,
        },
      })
    );
    console.log(`[license] fx rate updated: 1 USD = ${rate} JPY`);
  } catch (e) {
    // Keep using the previous day's rate (design doc ch.6); notify the admin
    // so a prolonged outage does not go unnoticed.
    console.error('[license] failed to update fx rate', e);
    await alertAdmin(
      '【GenU版GaiXer】為替レートの自動取得に失敗しました',
      `為替レートの取得に失敗しました。前回取得済みのレートを使い続けます。\nエラー: ${e}`
    );
  }
};
