'use strict';

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatch } from '@aws-sdk/client-cloudwatch';

const client = new DynamoDBClient();
const cloudwatch = new CloudWatch();

const USER_REGISTRATION_TABLE_NAME = process.env.USER_REGISTRATION_TABLE_NAME;
const TOKEN_USAGE_STATS_TABLE_NAME = process.env.TOKEN_USAGE_STATS_TABLE_NAME;

const METRIC_NAMESPACE = 'BIMetrics/DynamoDB';
const USER_COUNT_METRIC_NAME = 'UsersCount';
const USER_COUNT_MONTHLY_ACTIVE_METRIC_NAME = 'UsersCountMonthlyActive';
const USER_COUNT_USAGE_LIMIT_REACHED_METRIC_NAME = 'UsersCountUsageLimitReached';

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
  if (!TOKEN_USAGE_STATS_TABLE_NAME) {
    throw new Error('TOKEN_USAGE_STATS_TABLE_NAME environment variable is not set.');
  }

  const searchPrefix = getCurrentYearMonthInJST(); // "YYYY-MM" 形式

  // ScanCommand のパラメータ設定
  let scanParams = {
    TableName: TOKEN_USAGE_STATS_TABLE_NAME,
    // 必要な属性のみ取得: 日付属性と userId 属性
    ProjectionExpression: "userId, executions",
    // 日付属性が SEARCH_PREFIX で始まるものをフィルタリング
    FilterExpression: "contains(id, :month)",
    ExpressionAttributeValues: { ":month": { S: searchPrefix } },
    Limit: 1000 // 1回のScanで取得する最大件数
  };

  let lastEvaluatedKey;
  const userExecutions = {}; // 集計結果を格納
  try {
    do {
      if (lastEvaluatedKey) {
        scanParams.ExclusiveStartKey = lastEvaluatedKey;
      }

      const scanCommand = new ScanCommand(scanParams);
      const response = await client.send(scanCommand);
      console.log('Scan response:', response);

      const items = response.Items || [];
      for (const item of items) {
        const userId = item["userId"].S;
        console.log(userId);

        // 日付属性が検索プレフィックスに一致し、かつ userId が存在するか確認
        if (userId !== undefined) {
          // userId をキーとして、データを保持
          userExecutions[userId] = item["executions"]
        }
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
  for (const execution in userExecutions) {
    console.log(`User ${execution} has count ${userExecutions[execution].M.overall.N} for month ${searchPrefix}`);
    monthlyActiveUserCount += 1;
    if (userExecutions[execution].M.overall.N >= 30) {
      usageLimitedUserCount += 1;
    }
  }

  return [monthlyActiveUserCount, usageLimitedUserCount];
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

export async function handler(event, context) {
  try {
    // ユーザー数を取得・メトリクスを公開
    const userCount = await getUserCount();
    await publishMetric(USER_COUNT_METRIC_NAME, userCount);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${USER_COUNT_METRIC_NAME} = ${userCount}`);

    // 9タイプを登録したユーザー数を取得・メトリクスを公開

    // 少なくとも一度チャットまたはAIコンテンツ機能を利用したユーザー数、AIコンテンツ機能を30回使い切ったユーザー数を取得・メトリクスを公開
    const [monthlyActiveUserCount, usageLimitedUserCount] = await getActiveOrLimitReachedUserCount();
    await publishMetric(USER_COUNT_MONTHLY_ACTIVE_METRIC_NAME, monthlyActiveUserCount);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${USER_COUNT_MONTHLY_ACTIVE_METRIC_NAME} = ${monthlyActiveUserCount}`);
    await publishMetric(USER_COUNT_USAGE_LIMIT_REACHED_METRIC_NAME, usageLimitedUserCount);
    console.log(`Published CloudWatch metric ${METRIC_NAMESPACE}/${USER_COUNT_USAGE_LIMIT_REACHED_METRIC_NAME} = ${usageLimitedUserCount}`);


    return { userCount, monthlyActiveUserCount, usageLimitedUserCount };
  } catch (err) {
    console.error('Error counting items or publishing metric:', err);
    throw err;
  }
}