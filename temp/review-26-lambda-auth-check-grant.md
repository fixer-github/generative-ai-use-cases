# レビュー結果: Lambda Authorization - Check & Grant

## 担当ファイル
- `/packages/cdk/lambda/authorization/checkPermission.ts` (273行, 新規作成)
- `/packages/cdk/lambda/authorization/grantPermission.ts` (328行, 新規作成)

## 重大な問題（Critical）

### 1. checkPermission.ts: OpenFGAエラー時のレスポンス問題
**ファイル**: checkPermission.ts (行160-172)

**問題**:
```typescript
try {
  const checkResponse = await makeSignedOpenFgaRequest(...);
  const checkResult = JSON.parse(checkResponse);
  hasPermission = checkResult.allowed === true;
} catch (openFgaError) {
  console.error('OpenFGA check failed:', openFgaError);
  // OpenFGAへのアクセスに失敗した場合は拒否する
  return {
    allowed: false,
    reason: 'no_permission',
  };
}
```

**指摘**:
- OpenFGAへのアクセス失敗時に `reason: 'no_permission'` を返しているが、これは「権限がない」という意味になる
- 実際には「システムエラー」であるため、理由コードが不適切
- クライアント側で「権限がない」のか「システムエラー」なのかを区別できない

**推奨**:
- OpenFGAエラー時は `reason: 'system_error'` など別の理由コードを使用すべき
- または例外を上位にスローしてエラーハンドリングを統一すべき

### 2. checkPermission.ts: 最終エラーハンドリングの情報損失
**ファイル**: checkPermission.ts (行262-269)

**問題**:
```typescript
catch (error) {
  console.error('Error in checkPermission:', error);
  // エラーが発生した場合は安全側に倒して拒否する
  return {
    allowed: false,
    reason: 'no_permission',
  };
}
```

**指摘**:
- すべてのエラーを `no_permission` として返している
- バリデーションエラー、テナント情報の取得失敗、AssumeRole失敗、DynamoDBエラーなど、様々なエラーが混在
- クライアント側でエラーの種類を判別できない
- デバッグが困難

**推奨**:
- エラーの種類に応じて適切な理由コードを返すか、例外をスローすべき
- 少なくとも `system_error` と `no_permission` は区別すべき

### 3. grantPermission.ts: ロールバック処理の不完全性
**ファイル**: grantPermission.ts (行277-304)

**問題**:
```typescript
} catch (dynamoError) {
  // DynamoDBへの書き込みに失敗した場合、OpenFGAの関係性を削除してロールバック
  console.error('DynamoDB write failed, rolling back OpenFGA tuples:', dynamoError);

  const deleteTuplesBody = {
    deletes: {
      tuple_keys: tupleKeys,
    },
  };

  try {
    await makeSignedOpenFgaRequest(...);
    console.log('OpenFGA tuples rolled back successfully');
  } catch (rollbackError) {
    console.error('Failed to rollback OpenFGA tuples:', rollbackError);
  }

  throw new Error(`Failed to write to DynamoDB: ${dynamoError}`);
}
```

**指摘**:
- ロールバック自体が失敗した場合、OpenFGAとDynamoDBの間でデータ不整合が発生する
- ロールバック失敗時にエラーログを出力するのみで、アラート機構がない
- 手動での修復が必要になる可能性があるが、その検知手段がない

**推奨**:
- ロールバック失敗時は重大なエラーとしてCloudWatch Alarmなどに通知すべき
- または、補償トランザクション用のDead Letter Queueに記録して後で再試行すべき
- せめてエラーメッセージに「データ不整合が発生した可能性がある」旨を明示すべき

## 警告レベルの問題（Warning）

### 4. checkPermission.ts: DynamoDBエラーハンドリングの欠如
**ファイル**: checkPermission.ts (行182-248)

**問題**:
```typescript
const dynamoDBClient = await createTenantDynamoDBClientForBackgroundJob(tenantId);
// ...
const dailyCounter = await usageCountRepository.get(userId, `${featureId}#daily`);
const monthlyCounter = await usageCountRepository.get(userId, `${featureId}#monthly`);
```

**指摘**:
- DynamoDBへのアクセス時に例外が発生した場合、try-catchの外側のハンドラで捕捉される
- すべて `no_permission` として返されてしまう
- DynamoDB一時障害時にユーザーが機能を使えなくなる

**推奨**:
- DynamoDBアクセス部分を個別にtry-catchで囲み、エラー時の挙動を明示すべき
- 一時的なエラー時はリトライロジックを検討すべき

### 5. checkPermission.ts: usage情報のデータ不整合リスク
**ファイル**: checkPermission.ts (行204-247)

**問題**:
```typescript
const usage: CheckPermissionResponse['usage'] = {};

// 日次制限のチェック
if (dailyCounter) {
  const remaining = dailyCounter.limitCount - dailyCounter.currentCount;
  usage.daily = {
    current: dailyCounter.currentCount,
    limit: dailyCounter.limitCount,
    remaining: Math.max(0, remaining),
  };

  if (dailyCounter.currentCount >= dailyCounter.limitCount) {
    return { allowed: false, reason: 'quota_exceeded', usage };
  }
}
```

**指摘**:
- 日次制限で拒否された場合、月次情報が `usage` に含まれない
- クライアント側が月次の残数情報を取得できない
- UIで「月次はまだ余裕があるのに拒否された」状況が伝わらない

**推奨**:
- 日次制限で拒否する場合でも、月次情報を取得して含めるべき
- または、両方のチェックを完了してから最終判定を行うべき

### 6. grantPermission.ts: バリデーションエラーメッセージの不親切さ
**ファイル**: grantPermission.ts (行130-152)

**問題**:
```typescript
if (!tenantId || !userId || !grantId || !features || !sourceType || !sourceId) {
  throw new Error('Missing required parameters: tenantId, userId, grantId, features, sourceType, sourceId');
}

if (features.length === 0) {
  throw new Error('features array must not be empty');
}

for (const feature of features) {
  if (!feature.featureId || !feature.limitType) {
    throw new Error('Each feature must have featureId and limitType');
  }
  // ...
}
```

**指摘**:
- どのパラメータが欠けているのかが不明（最初のエラーメッセージ）
- どのfeatureでエラーが発生したのかが不明（ループ内のエラー）
- デバッグが困難

**推奨**:
- 具体的な欠落パラメータを示すべき
- feature配列のインデックスやfeatureIdを含めるべき

### 7. 両ファイル: AssumeRole時のセッション名の情報漏洩リスク
**ファイル**: checkPermission.ts (行118), grantPermission.ts (行164)

**問題**:
```typescript
// checkPermission.ts
RoleSessionName: `CheckPermission-${userId}-${featureId}`,

// grantPermission.ts
RoleSessionName: `GrantPermission-${grantId}`,
```

**指摘**:
- CloudTrailログにセッション名が記録される
- userIdやfeatureIdが平文でログに残る
- 個人情報やビジネスロジックの機密情報が含まれる可能性

**推奨**:
- セッション名にはハッシュ値を使用するか、より一般的な名前を使用すべき
- 例: `CheckPermission-${Date.now()}-${randomId}` など

### 8. 両ファイル: テーブル名生成ロジックの重複
**ファイル**: checkPermission.ts (行27-34), grantPermission.ts (行28-35)

**問題**:
```typescript
function getTableName(baseTableName: string, tenantId: string, environment: string): string {
  const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9-]/g, '-');
  return `${baseTableName}-${environment}-tenant-${sanitizedTenantId}`;
}
```

**指摘**:
- 同じロジックが2つのファイルに重複
- 将来的に命名規則が変更された場合、両方を修正する必要がある
- 修正漏れのリスク

**推奨**:
- 共通ユーティリティファイルに抽出すべき
- 他のLambda関数でも使用される可能性が高い

### 9. 両ファイル: makeSignedOpenFgaRequest関数の重複
**ファイル**: checkPermission.ts (行39-91), grantPermission.ts (行63-117)

**問題**:
- 同じ署名付きリクエスト処理が2つのファイルに重複（100行以上）
- OpenFGAクライアントロジックの重複

**指摘**:
- DRY原則違反
- 将来的に署名ロジックが変更された場合、両方を修正する必要がある
- セキュリティパッチ適用時のリスク

**推奨**:
- 共通ユーティリティファイルに抽出すべき
- 既存の `utils/tenantSsmParameters.ts` のような場所に配置すべき

### 10. grantPermission.ts: calculateNextResetTime関数のタイムゾーン問題
**ファイル**: grantPermission.ts (行40-58)

**問題**:
```typescript
function calculateNextResetTime(periodType: 'daily' | 'monthly'): number {
  const now = new Date();
  let nextReset: Date;

  if (periodType === 'daily') {
    // 翌日の午前0時（UTC）
    nextReset = new Date(now);
    nextReset.setUTCDate(nextReset.getUTCDate() + 1);
    nextReset.setUTCHours(0, 0, 0, 0);
  } else {
    // 翌月1日の午前0時（UTC）
    nextReset = new Date(now);
    nextReset.setUTCMonth(nextReset.getUTCMonth() + 1);
    nextReset.setUTCDate(1);
    nextReset.setUTCHours(0, 0, 0, 0);
  }

  return Math.floor(nextReset.getTime() / 1000);
}
```

**指摘**:
- UTCを使用しているため、日本のユーザーは9時にリセットされる
- ビジネス要件として「日本時間の0時にリセット」が必要な場合、仕様を満たさない
- テナントごとにタイムゾーンが異なる可能性

**推奨**:
- ビジネス要件を確認すべき
- 必要に応じてテナントのタイムゾーン設定を考慮すべき

## 軽微な問題・改善提案（Info）

### 11. checkPermission.ts: 型定義の厳密性向上
**ファイル**: checkPermission.ts (行162)

**提案**:
```typescript
// 現状
const checkResult = JSON.parse(checkResponse);
hasPermission = checkResult.allowed === true;

// 改善案
interface OpenFgaCheckResult {
  allowed: boolean;
}
const checkResult = JSON.parse(checkResponse) as OpenFgaCheckResult;
hasPermission = checkResult.allowed === true;
```

**理由**:
- 型安全性の向上
- OpenFGA APIレスポンスの構造が明示的になる

### 12. grantPermission.ts: トランザクションログの充実
**ファイル**: grantPermission.ts (行205-211)

**提案**:
```typescript
// 現状
console.log('Writing tuples to OpenFGA:', JSON.stringify(writeTuplesBody, null, 2));

// 改善案
console.log('[GrantPermission] Transaction start', {
  grantId,
  tenantId,
  userId,
  featureCount: features.length,
  timestamp: new Date().toISOString()
});
console.log('[GrantPermission] Writing tuples to OpenFGA:', JSON.stringify(writeTuplesBody, null, 2));
```

**理由**:
- トラブルシューティング時にログを追跡しやすくなる
- トランザクション境界が明確になる

### 13. 両ファイル: 環境変数のバリデーション欠如
**ファイル**: checkPermission.ts (行186), grantPermission.ts (行221)

**提案**:
```typescript
// 現状
const environment = process.env.ENVIRONMENT || 'dev'

// 改善案
const environment = process.env.ENVIRONMENT;
if (!environment) {
  throw new Error('ENVIRONMENT environment variable is not set');
}
```

**理由**:
- 本番環境で `dev` がフォールバックとして使用されるリスクを回避
- 設定ミスの早期検出

### 14. checkPermission.ts: ログ出力の整合性
**ファイル**: checkPermission.ts (全体)

**提案**:
- 成功時のログレベルと失敗時のログレベルを統一
- 構造化ログ（JSON形式）の使用を検討
- リクエストIDやトレースIDの追加

**例**:
```typescript
console.log(JSON.stringify({
  level: 'INFO',
  message: 'Check permission completed',
  tenantId,
  userId,
  featureId,
  allowed: response.allowed,
  timestamp: new Date().toISOString()
}));
```

### 15. grantPermission.ts: 権限付与時のべき等性保証
**ファイル**: grantPermission.ts (行240-268)

**提案**:
- 同じ `grantId` で複数回呼ばれた場合の挙動を明示的にする
- DynamoDBの条件付き書き込み（ConditionExpression）を使用してべき等性を保証

**現状の問題**:
- 同じgrantIdで2回呼ばれた場合、2重で権限が付与される可能性
- リトライ処理での問題

### 16. 両ファイル: パフォーマンス最適化の余地
**ファイル**: checkPermission.ts (行196-208), grantPermission.ts (行240-268)

**提案**:
```typescript
// 現状: 逐次処理
const dailyCounter = await usageCountRepository.get(userId, `${featureId}#daily`);
const monthlyCounter = await usageCountRepository.get(userId, `${featureId}#monthly`);

// 改善案: 並列処理
const [dailyCounter, monthlyCounter] = await Promise.all([
  usageCountRepository.get(userId, `${featureId}#daily`),
  usageCountRepository.get(userId, `${featureId}#monthly`)
]);
```

**理由**:
- レスポンス時間の短縮
- DynamoDBへの2つのGetItem呼び出しを並列化

### 17. checkPermission.ts: usage情報の計算ロジックの共通化
**ファイル**: checkPermission.ts (行207-245)

**提案**:
日次と月次で同じような計算ロジックが繰り返されているため、関数に抽出すべき

```typescript
function buildUsageInfo(counter: UsageCounterItem | null) {
  if (!counter) return null;
  const remaining = counter.limitCount - counter.currentCount;
  return {
    current: counter.currentCount,
    limit: counter.limitCount,
    remaining: Math.max(0, remaining),
  };
}
```

### 18. 両ファイル: コメントの国際化
**ファイル**: 両ファイル全体

**提案**:
- 日本語コメントと英語コメントが混在している
- チームの方針に応じてどちらかに統一すべき

### 19. grantPermission.ts: features配列のバリデーション強化
**ファイル**: grantPermission.ts (行143-152)

**提案**:
```typescript
// 追加のバリデーション
for (const feature of features) {
  // limitTypeの値チェック
  if (!['unlimited', 'daily', 'monthly'].includes(feature.limitType)) {
    throw new Error(`Invalid limitType: ${feature.limitType}`);
  }

  // featureIdのフォーマットチェック
  if (!/^[a-zA-Z0-9-_]+$/.test(feature.featureId)) {
    throw new Error(`Invalid featureId format: ${feature.featureId}`);
  }
}
```

### 20. checkPermission.ts: OpenFGAレスポンスのバリデーション
**ファイル**: checkPermission.ts (行162-164)

**提案**:
```typescript
// 現状
const checkResult = JSON.parse(checkResponse);
hasPermission = checkResult.allowed === true;

// 改善案
const checkResult = JSON.parse(checkResponse);
if (typeof checkResult.allowed !== 'boolean') {
  throw new Error('Invalid OpenFGA response: missing or invalid "allowed" field');
}
hasPermission = checkResult.allowed === true;
```

## 総合評価

**要修正**

### 評価サマリー

本実装は権限チェックと権限付与の基本的な機能を満たしていますが、以下の重大な問題があります:

1. **エラーハンドリングの不適切さ**: システムエラーと権限エラーを区別できず、クライアント側での適切なエラー処理が困難
2. **データ整合性リスク**: ロールバック失敗時のフォールバック機構が不十分
3. **情報セキュリティの懸念**: CloudTrailログへの機密情報の記録

### 優先対応事項（重要度順）

1. **Critical #1, #2**: エラーハンドリングの見直し（reason コードの追加・分類）
2. **Critical #3**: ロールバック失敗時のアラート機構の追加
3. **Warning #7**: AssumeRoleセッション名からの情報漏洩対策
4. **Warning #4**: DynamoDB エラーハンドリングの個別化
5. **Warning #8, #9**: 共通ユーティリティへのリファクタリング

### 良い点

- OpenFGAとDynamoDBを組み合わせた権限管理アーキテクチャは適切
- テナント分離のためのAssumeRoleパターンが正しく実装されている
- 基本的なバリデーションが行われている
- ロールバック処理の考慮がされている（完全ではないが）

### 次のステップ

1. Critical問題の修正（エラーハンドリング、ロールバックアラート）
2. Warning問題の修正（共通化、セキュリティ）
3. 統合テストの実施（エラーケース、ロールバックシナリオ）
4. パフォーマンステストの実施
5. セキュリティレビューの実施
