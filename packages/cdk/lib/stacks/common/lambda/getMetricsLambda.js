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
const USER_COUNT_DAILY_ACTIVE_METRIC_NAME = 'UsersCountDailyActive';
const USER_COUNT_USAGE_LIMIT_REACHED_METRIC_NAME = 'UsersCountUsageLimitReached';
const LLM_USAGE_COUNT_MONTHLY_METRIC_NAME = 'LLMUsageMonthlyCount';
const LLM_USAGE_COUNT_DAILY_METRIC_NAME = 'LLMUsageDailyCount';

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
// [<月間アクティブユーザー数>, <日次アクティブユーザー数>, <利用上限に達したユーザー数>, <月次のLLM使用回数>, <日次のLLM使用回数>]の形でレスポンスする
async function getActiveOrLimitReachedUserCount() {
  if (!AUTH_USAGE_EVENTS_TABLE_NAME) {
    throw new Error('AUTH_USAGE_EVENTS_TABLE_NAME environment variable is not set.');
  }

  const searchPrefix = getCurrentYearMonthInJST(); // "YYYY-MM" 形式
  const startTimeMonthly = getPeriodStartTime("monthly");
  const startTimeDaily = getPeriodStartTime("daily");
  const endTime = Date.now();
  let llmUsageCountMonthly = 0;
  let llmUsageCountDaily = 0;

  // QueryCommand のパラメータ設定
  let scanParams = {
    TableName: AUTH_USAGE_EVENTS_TABLE_NAME,
    // 必要な属性のみ取得: featureIdと userId 属性
    ProjectionExpression: "userId, featureId, #ts",
    ExpressionAttributeNames: {
      "#ts": "timestamp" // "#ts" という別名で "timestamp" という予約語をマッピング
    },
    // timestampが今月のものでフィルタリング
    FilterConditionExpression: `timestamp BETWEEN ${startTimeMonthly} AND ${endTime}`,
    Limit: 1000 // 1回のScanで取得する最大件数
  };

  let lastEvaluatedKey;
  const usagesMonthly = {}; // 月次の集計結果を格納
  const usagesDaily = {}; // 日次の集計結果を格納

  let activeUserCountMonthly = 0;
  let activeUserCountDaily = 0;

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
        if (usagesMonthly[userId]) {
          usagesMonthly[userId]++;
        } else {
          usagesMonthly[userId] = 1;
        }
        llmUsageCountMonthly++;
        if (item["timestamp"].N >= startTimeDaily) {
          llmUsageCountDaily++;
          if (usagesDaily[userId]) {
            usagesDaily[userId]++;
          } else {
            usagesDaily[userId] = 1;
            activeUserCountDaily++;
          }
        }
      }
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);
  } catch (err) {
    console.error('Scan COUNT failed:', err);
    throw err;
  }

  let usageLimitedUserCount = 0;
  // カウント結果をもとに、月間アクティブユーザー数と利用上限に達したユーザー数を計算
  for (const usage in usagesMonthly) {
    // console.log(`User ${usage} has count ${usagesMonthly[usage]} for month ${searchPrefix}`);
    activeUserCountMonthly++;
    // Todo: 利用上限の閾値はテーブルから取ってくるようにする
    if (usagesMonthly[usage] >= 30) {
      usageLimitedUserCount++;
    }
  }

  return [activeUserCountMonthly, activeUserCountDaily, usageLimitedUserCount, llmUsageCountMonthly, llmUsageCountDaily];
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
    const [activeUserCountMonthly, activeUserCountDaily, usageLimitedUserCount, llmUsageCountMonthly, llmUsageCountDaily] = await getActiveOrLimitReachedUserCount();
    await publishMetric(USER_COUNT_MONTHLY_ACTIVE_METRIC_NAME, activeUserCountMonthly);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${USER_COUNT_MONTHLY_ACTIVE_METRIC_NAME} = ${activeUserCountMonthly}`);
    await publishMetric(USER_COUNT_DAILY_ACTIVE_METRIC_NAME, activeUserCountDaily);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${USER_COUNT_DAILY_ACTIVE_METRIC_NAME} = ${activeUserCountMonthly}`);
    await publishMetric(USER_COUNT_USAGE_LIMIT_REACHED_METRIC_NAME, usageLimitedUserCount);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${USER_COUNT_USAGE_LIMIT_REACHED_METRIC_NAME} = ${usageLimitedUserCount}`);
    await publishMetric(LLM_USAGE_COUNT_MONTHLY_METRIC_NAME, llmUsageCountMonthly);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${LLM_USAGE_COUNT_MONTHLY_METRIC_NAME} = ${llmUsageCountMonthly}`);
    await publishMetric(LLM_USAGE_COUNT_DAILY_METRIC_NAME, llmUsageCountDaily);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${LLM_USAGE_COUNT_DAILY_METRIC_NAME} = ${llmUsageCountDaily}`);


    return { userCount, activeUserCountMonthly, activeUserCountDaily, usageLimitedUserCount, llmUsageCountMonthly, llmUsageCountDaily };
  } catch (err) {
    console.error('Error counting items or publishing metric:', err);
    throw err;
  }
}