/**
 * Bot Export
 * DynamoDB の Bot テーブルを JSON 形式でエクスポート
 */

import * as fs from 'fs';
import * as path from 'path';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { V053Bot, AWSClientConfig, ExportResult } from '../types';
import { createDynamoDBDocClient } from '../utils/aws';

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Bot テーブルをスキャンしてデータを取得
 */
export async function scanBotTable(
  tableName: string,
  docClient: DynamoDBDocumentClient
): Promise<V053Bot[]> {
  const items: V053Bot[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  let scanCount = 0;

  console.log(`テーブル "${tableName}" をスキャン中...`);

  do {
    const response = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    scanCount++;

    if (response.Items) {
      items.push(...(response.Items as V053Bot[]));
    }

    lastEvaluatedKey = response.LastEvaluatedKey;

    // 進捗をログ出力
    if (scanCount % 10 === 0) {
      console.log(`  スキャン中... ${items.length} 件のアイテムを取得`);
    }
  } while (lastEvaluatedKey);

  console.log(`  完了: ${items.length} 件のアイテムを取得`);

  return items;
}

/**
 * Bot データを JSON ファイルに保存
 */
export function saveBotData(
  bots: V053Bot[],
  tableName: string,
  outputPath: string
): ExportResult {
  // 出力ディレクトリを作成
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const exportedAt = new Date().toISOString();

  // エクスポートデータを作成
  const exportData = {
    tableName,
    exportedAt,
    itemCount: bots.length,
    Items: bots,
  };

  // JSON ファイルに書き込み
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');

  console.log(`${bots.length} 件のアイテムを ${outputPath} にエクスポートしました`);

  return {
    tableName,
    outputPath,
    itemCount: bots.length,
    exportedAt,
  };
}

/**
 * Bot テーブルをエクスポート
 */
export async function exportBotTable(
  tableName: string,
  outputPath: string,
  config: AWSClientConfig
): Promise<ExportResult> {
  const docClient = createDynamoDBDocClient(config);

  // テーブルをスキャン
  const bots = await scanBotTable(tableName, docClient);

  // JSON ファイルに保存
  return saveBotData(bots, tableName, outputPath);
}
