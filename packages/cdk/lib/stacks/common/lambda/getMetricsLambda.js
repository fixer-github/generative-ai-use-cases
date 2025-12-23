'use strict';

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatch } from '@aws-sdk/client-cloudwatch';

const client = new DynamoDBClient();
const cloudwatch = new CloudWatch();

const USER_REGISTRATION_TABLE_NAME = process.env.USER_REGISTRATION_TABLE_NAME;
const TOKEN_USAGE_STATS_TABLE_NAME = process.env.TOKEN_USAGE_STATS_TABLE_NAME;
const AUTH_USAGE_EVENTS_TABLE_NAME = process.env.AUTH_USAGE_EVENTS_TABLE_NAME;

const METRIC_NAMESPACE = 'BIMetrics/DynamoDB';
const USER_COUNT_METRIC_NAME = 'UsersCount';
const USER_COUNT_MONTHLY_ACTIVE_METRIC_NAME = 'UsersCountMonthlyActive';
const USER_COUNT_USAGE_LIMIT_REACHED_METRIC_NAME = 'UsersCountUsageLimitReached';
const LLM_USAGE_COUNT_METRIC_NAME = 'LLMUsageCount';

// ユーザーテーブルの件数を取得する関数
async function getUserCount() {
  if (!USER_REGISTRATION_TABLE_NAME) {
    throw new Error('USER_REGISTRATION_TABLE_NAME environment variable is not set.');
  }

  let total = 0;
  let lastKey = undefined;
  // キーのページネーション対応
  try {
    do {
      let params = {
        TableName: USER_REGISTRATION_TABLE_NAME,
        // COUNT のみを返す
        Select: 'COUNT'
      };
      if (lastKey) {
        params.ExclusiveStartKey = lastKey;
      }

      const response = await client.send(new ScanCommand(params));

      total += response.Count ? response.Count : 0;
      lastKey = response.LastEvaluatedKey;
    } while (lastKey);

    return total;
  } catch (err) {
    console.error('Scan COUNT failed:', err);
    throw err;
  }
}

// 今月チャット機能を一度でも使用したユーザー、30回利用しきったユーザー数を取得する関数
// [<月間アクティブユーザー数>, <利用上限に達したユーザー数>]の形でレスポンスする
async function getActiveOrLimitReachedUserCount() {
  if (!AUTH_USAGE_EVENTS_TABLE_NAME) {
    throw new Error('AUTH_USAGE_EVENTS_TABLE_NAME environment variable is not set.');
  }

  const searchPrefix = getCurrentYearMonthInJST(); // "YYYY-MM" 形式
  const startTime = getPeriodStartTime("monthly");
  const endTime = Date.now();
  let llmUsageCount = 0;

  // QueryCommand のパラメータ設定
  let scanParams = {
    TableName: AUTH_USAGE_EVENTS_TABLE_NAME,
    // 必要な属性のみ取得: featureIdと userId 属性
    ProjectionExpression: "userId, featureId",
    // timestampが今月のものでフィルタリング
    FilterConditionExpression: `timestamp BETWEEN ${startTime} AND ${endTime}`,
    Limit: 1000 // 1回のScanで取得する最大件数
  };

  let lastEvaluatedKey;
  const usages = {}; // 集計結果を格納
  try {
    do {
      if (lastEvaluatedKey) {
        scanParams.ExclusiveStartKey = lastEvaluatedKey;
      }

      console.log('Scanning with params:', scanParams);
      const queryCommand = new ScanCommand(scanParams);
      const response = await client.send(queryCommand);
      console.log('Scan response:', response);

      const items = response.Items || [];
      for (const item of items) {
        const userId = item["userId"].S;
        // userId をキーとして、データ個数を保持
        // Todo: featureId ごとに分ける場合はここを修正
        if (usages[userId]) {
          usages[userId]++;
        } else {
          usages[userId] = 1;
        }
        llmUsageCount++;
      }
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (err) {
    console.error('Scan COUNT failed:', err);
    throw err;
  }

  let monthlyActiveUserCount = 0;
  let usageLimitedUserCount = 0;
  // カウント結果をもとに、月間アクティブユーザー数と利用上限に達したユーザー数を計算
  for (const usage in usages) {
    console.log(`User ${usage} has count ${usages[usage]} for month ${searchPrefix}`);
    monthlyActiveUserCount += 1;
    // Todo: 利用上限の閾値はテーブルから取ってくるようにする
    if (usages[usage] >= 30) {
      usageLimitedUserCount += 1;
    }
  }

  return [monthlyActiveUserCount, usageLimitedUserCount, llmUsageCount];
}

// メトリクスをCloudWatchに公開する関数
async function publishMetric(metricsName, tableCount) {
  const metricData = [
    {
      MetricName: metricsName,
      // Dimensions: DIMENSIONS,
      Value: tableCount,
      Unit: 'Count'
    }
  ];

  const params = {
    Namespace: METRIC_NAMESPACE,
    MetricData: metricData
  };

  await cloudwatch.putMetricData(params);
}

// JSTの日付を "YYYY-MM" 形式で取得する関数
function getCurrentYearMonthInJST() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Tokyo'
  });
  // 出力例: "2025-12"
  return formatter.format(now);
}

// 指定された期間タイプ（日次または月次）の開始時刻をUTCで取得する関数
function getPeriodStartTime(periodType) {
  const JST_OFFSET = 9 * 60 * 60 * 1e3;
  const now = /* @__PURE__ */ new Date();
  const nowJST = new Date(now.getTime() + JST_OFFSET);
  let startTimeJST;
  if (periodType === "daily") {
    startTimeJST = new Date(nowJST);
    startTimeJST.setUTCHours(0, 0, 0, 0);
  } else {
    startTimeJST = new Date(nowJST);
    startTimeJST.setUTCDate(1);
    startTimeJST.setUTCHours(0, 0, 0, 0);
  }
  const startTimeUTC = new Date(startTimeJST.getTime() - JST_OFFSET);
  return startTimeUTC.getTime();
}

export async function handler(event, context) {
  try {
    // ユーザー数を取得・メトリクスを公開
    const userCount = await getUserCount();
    await publishMetric(USER_COUNT_METRIC_NAME, userCount);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${USER_COUNT_METRIC_NAME} = ${userCount}`);

    // 9タイプを登録したユーザー数を取得・メトリクスを公開

    // 少なくとも一度チャットまたはAIコンテンツ機能を利用したユーザー数、AIコンテンツ機能を30回使い切ったユーザー数を取得・メトリクスを公開
    const [monthlyActiveUserCount, usageLimitedUserCount, llmUsageCount] = await getActiveOrLimitReachedUserCount();
    await publishMetric(USER_COUNT_MONTHLY_ACTIVE_METRIC_NAME, monthlyActiveUserCount);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${USER_COUNT_MONTHLY_ACTIVE_METRIC_NAME} = ${monthlyActiveUserCount}`);
    await publishMetric(USER_COUNT_USAGE_LIMIT_REACHED_METRIC_NAME, usageLimitedUserCount);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${USER_COUNT_USAGE_LIMIT_REACHED_METRIC_NAME} = ${usageLimitedUserCount}`);
    await publishMetric(LLM_USAGE_COUNT_METRIC_NAME, llmUsageCount);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${LLM_USAGE_COUNT_METRIC_NAME} = ${llmUsageCount}`);


    return { userCount, monthlyActiveUserCount, usageLimitedUserCount, llmUsageCount };
  } catch (err) {
    console.error('Error counting items or publishing metric:', err);
    throw err;
  }
}