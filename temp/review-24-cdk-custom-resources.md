# レビュー結果: CDK Custom Resources

## 担当ファイル
- packages/cdk/lib/stacks/tenant/custom-resources/openFgaMigrateRunner.ts (新規作成, 272行)
- packages/cdk/lib/stacks/tenant/custom-resources/openFgaSchema.ts (新規作成, 189行)
- packages/cdk/lib/stacks/tenant/custom-resources/openFgaSchemaInitializer.ts (新規作成, 237行)
- packages/cdk/custom-resources/opensearch-tenant-updater.js (削除, 182行)
- packages/cdk/custom-resources/package.json (依存関係の整理)
- packages/cdk/custom-resources/package-lock.json (依存関係の整理)

## 重大な問題（Critical）

### 1. openFgaMigrateRunner.ts: PhysicalResourceId の一貫性の問題

**問題箇所**: 57-72行、226行、266行

```typescript
// 常に同じIDを使用
const physicalResourceId = 'openfga-migrate-runner';
```

**問題点**:
- `PhysicalResourceId` が固定文字列になっており、テナント識別子が含まれていない
- 複数テナント環境において、同じCustom Resourceが複数回作成された場合の識別が困難
- CloudFormationのリソース管理上、テナント単位での識別が必要

**推奨対処**:
```typescript
const physicalResourceId = `openfga-migrate-runner-${props.TenantId || 'unknown'}`;
```

### 2. openFgaSchemaInitializer.ts: エラー時のPhysicalResourceId判定の問題

**問題箇所**: 224-227行

```typescript
const physicalResourceId =
  'PhysicalResourceId' in event
    ? event.PhysicalResourceId
    : `openfga-schema-${props.TenantId}-error`;
```

**問題点**:
- TypeScriptの型定義上、`CloudFormationCustomResourceEvent`には`PhysicalResourceId`が常に存在しない
- `event.RequestType === 'Create'`の場合、`PhysicalResourceId`は存在しない
- 正しい判定は`event.RequestType`による分岐が必要

**推奨対処**:
```typescript
const physicalResourceId =
  event.RequestType === 'Create'
    ? `openfga-schema-${props.TenantId}-error`
    : event.PhysicalResourceId;
```

### 3. openFgaMigrateRunner.ts: 冪等性の判定が脆弱

**問題箇所**: 128-143行

```typescript
if (
  reason.includes('goose_db_version') ||
  reason.includes('already exists') ||
  stoppedReason.includes('goose_db_version') ||
  stoppedReason.includes('already exists')
) {
  console.warn(
    'Migration appears to be already applied. Treating as success for idempotency.'
  );
  return;
}
```

**問題点**:
- 文字列マッチングによる冪等性判定は、エラーメッセージの変更に脆弱
- OpenFGAのバージョンアップでエラーメッセージが変わる可能性がある
- `exitCode`が0以外でも成功扱いするのは、真のエラーを隠蔽する危険性がある
- gooseの仕様として、既にマイグレーション済みの場合の`exitCode`と`reason`の仕様確認が必要

**推奨対処**:
- OpenFGA公式ドキュメントで、マイグレーション済みの場合の挙動を確認
- 可能であればgooseの終了コードによる判定に変更
- 少なくとも、ログに警告として記録し、モニタリングで検知できるようにする

## 警告レベルの問題（Warning）

### 1. openFgaMigrateRunner.ts: タイムアウト時のタスク停止処理がない

**問題箇所**: 156-159行

```typescript
throw new Error(
  `Migration task did not complete within ${maxPollingMinutes} minutes. ` +
    `Task may still be running. Check ECS console and CloudWatch Logs.`
);
```

**問題点**:
- タイムアウト時にECSタスクが停止されず、リソースが残り続ける可能性
- 次回デプロイ時に、前回のタスクと競合する可能性
- タイムアウト時はCloudFormationがロールバックするが、ECSタスクは停止されない

**推奨対処**:
- タイムアウト時には`ecs:StopTask`を呼び出してタスクを停止
- または、タイムアウトを許容してタスクの完了を待つ設計を明示

### 2. openFgaSchemaInitializer.ts: Update時のStoreId抽出ロジックが不安定

**問題箇所**: 183-184行

```typescript
const physicalResourceId = event.PhysicalResourceId;
const storeId = physicalResourceId.replace('openfga-store-', '');
```

**問題点**:
- `PhysicalResourceId`が期待する形式(`openfga-store-{storeId}`)でない場合の処理がない
- 人為的なスタック操作や不正な形式の場合にエラーになる
- プレフィックスが含まれない場合、`storeId`が不正な値になる

**推奨対処**:
```typescript
const storeIdMatch = physicalResourceId.match(/^openfga-store-(.+)$/);
if (!storeIdMatch) {
  throw new Error(`Invalid PhysicalResourceId format: ${physicalResourceId}`);
}
const storeId = storeIdMatch[1];
```

### 3. openFgaSchemaInitializer.ts: OpenFGA APIのエラーレスポンスのログ記録が不十分

**問題箇所**: 79-83行

```typescript
if (!response.ok) {
  const errorText = await response.text();
  throw new Error(
    `OpenFGA API request failed: ${response.status} ${response.statusText} - ${errorText}`
  );
}
```

**問題点**:
- リクエストボディが大きい場合、ログに記録されない
- デバッグ時に、どのようなリクエストで失敗したかが不明
- OpenFGAのエラー応答は通常JSON形式だが、text()で取得している

**推奨対処**:
```typescript
if (!response.ok) {
  const errorText = await response.text();
  console.error('OpenFGA API request failed:', {
    method,
    url,
    status: response.status,
    statusText: response.statusText,
    body: body ? JSON.stringify(body, null, 2).substring(0, 1000) : undefined,
    error: errorText,
  });
  throw new Error(
    `OpenFGA API request failed: ${response.status} ${response.statusText} - ${errorText}`
  );
}
```

### 4. openFgaMigrateRunner.ts: fetch APIのエラーハンドリング不足

**問題箇所**: 57-72行

```typescript
const response = await fetch(event.ResponseURL, {
  method: 'PUT',
  headers: {
    'Content-Type': '',
    'Content-Length': JSON.stringify(responseBody).length.toString(),
  },
  body: JSON.stringify(responseBody),
});

if (!response.ok) {
  console.error(
    'Failed to send CloudFormation response:',
    response.statusText
  );
}
```

**問題点**:
- `fetch`自体が失敗した場合(ネットワークエラーなど)、例外が処理されない
- CloudFormationへの応答送信失敗はLambda実行失敗とみなされ、リトライされる可能性
- しかし、リトライは冪等性を保証する必要がある

**推奨対処**:
```typescript
try {
  const response = await fetch(event.ResponseURL, {
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': JSON.stringify(responseBody).length.toString(),
    },
    body: JSON.stringify(responseBody),
  });

  if (!response.ok) {
    console.error(
      'Failed to send CloudFormation response:',
      response.statusText,
      await response.text()
    );
  }
} catch (error) {
  console.error('Failed to send CloudFormation response (network error):', error);
}
```

### 5. package.json: 依存関係の削除による影響範囲の確認不足

**問題箇所**: package.json

**削除された依存関係**:
- @aws-sdk/client-dynamodb
- @aws-sdk/client-sts
- @aws-sdk/credential-providers
- @aws-sdk/util-dynamodb

**問題点**:
- `opensearch-tenant-updater.js`の削除に伴う依存関係の削除だが、他のカスタムリソースで使用されていないか確認が必要
- `custom-resources`ディレクトリ内の他のファイルで使用されている可能性

**推奨対処**:
- `packages/cdk/custom-resources/` 配下の全てのJavaScriptファイルで、削除された依存関係が使用されていないか確認
- もし他のファイルで使用されている場合、削除は不適切

### 6. openFgaMigrateRunner.ts: Lambda実行時間に対してタスク完了待機時間が長い

**問題箇所**: 81行、472行

```typescript
// デフォルト10分待機
async function waitForTaskCompletion(
  clusterArn: string,
  taskArn: string,
  maxPollingMinutes: number = 10
): Promise<void>

// Lambdaタイムアウト: 10分
timeout: cdk.Duration.minutes(10),
```

**問題点**:
- Lambda実行時間は10分、タスク完了待機も10分
- ポーリングのオーバーヘッド(5秒間隔)により、実際にはタイムアウトする可能性がある
- Lambdaタイムアウトとタスク待機時間のバッファが不足

**推奨対処**:
- Lambda実行時間を12分に延長、またはタスク待機時間を8分に短縮
- タスク待機のタイムアウトは、Lambda実行時間の80%程度に設定するのが安全

## 軽微な問題・改善提案（Info）

### 1. openFgaSchemaInitializer.ts: Lambda VPC配置によるコールドスタート時間

**問題箇所**: tenant-openfga-stack.ts 650-653行

```typescript
vpc: props.vpc,
vpcSubnets: {
  subnets: props.subnets,
},
```

**改善提案**:
- Lambda関数がVPC内に配置されているため、コールドスタート時にENI作成のオーバーヘッドが発生
- OpenFGA内部エンドポイントへのアクセスには必要だが、初回実行が遅くなる可能性
- デプロイ時のタイムアウトに注意が必要

### 2. openFgaMigrateRunner.ts: CloudWatch Logsのログ保持期間が1週間

**問題箇所**: 283行

```typescript
logging: ecs.LogDrivers.awsLogs({
  streamPrefix: 'openfga-migrate',
  logRetention: logs.RetentionDays.ONE_WEEK,
}),
```

**改善提案**:
- マイグレーションログは障害調査に重要だが、保持期間が1週間のみ
- プロダクション環境では、少なくとも30日以上の保持が推奨
- または、設定可能にすることを推奨

### 3. openFgaSchema.ts: DEFAULT_LLM_MODELSが古いバージョンを含む

**問題箇所**: 166-173行

```typescript
export const DEFAULT_LLM_MODELS = [
  'anthropic.claude-3-5-sonnet-20240620-v1:0',
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-5-haiku-20241022-v1:0',
  'anthropic.claude-3-opus-20240229-v1:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
  'anthropic.claude-3-haiku-20240307-v1:0',
];
```

**改善提案**:
- Claude 3の旧バージョン(Opus, Sonnet, Haiku)が含まれているが、実際に使用されるか確認
- 使用しないモデルは削除することでセキュリティリスクを低減
- または、このリストの用途を明確化し、コメントで説明

### 4. openFgaSchemaInitializer.ts: 日本語コメントの使用

**問題箇所**: 144行、188行

```typescript
// OpenFGAでは新しいモデルをPOSTすることで更新
// 既存のtuples（権限データ）は保持され、新しいモデルが最新として使われる

// スキーマ定義の変更を反映

// エラー時のPhysicalResourceId: Update/Deleteなら既存のID、Createなら新規ID
```

**改善提案**:
- 他のファイルは英語コメントで統一されているが、このファイルのみ日本語コメントが混在
- コードベース全体の一貫性のため、英語コメントに統一を推奨

### 5. openFgaMigrateRunner.ts: ポーリング間隔がハードコード

**問題箇所**: 91行

```typescript
await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
```

**改善提案**:
- ポーリング間隔が5秒にハードコードされている
- 環境変数または定数として定義することで、調整しやすくなる
```typescript
const POLLING_INTERVAL_MS = 5000;
await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
```

### 6. openFgaSchemaInitializer.ts: Store作成の冪等性が保証されていない

**問題箇所**: 92-133行

**改善提案**:
- `Create`リクエストが再実行された場合、同じ名前のStoreが複数作成される可能性
- OpenFGA APIが同名Storeの作成を許可する場合、冪等性が失われる
- 理想的には、Store存在確認後に作成するロジックが必要
- ただし、CloudFormationのCustom ResourceはPhysicalResourceIdによる冪等性管理があるため、通常は問題にならない

### 7. 削除されたopensearch-tenant-updater.jsの影響範囲

**確認事項**:
- このカスタムリソースを使用していたスタックが存在する場合、削除後の動作を確認
- 既存環境でDynamoDBのOpenSearch設定フィールドが残ったままになる可能性
- マイグレーション計画が必要かどうかの確認

**推奨対処**:
- 既存テナントのDynamoDBレコードから、不要になったOpenSearch関連フィールドを削除するマイグレーションスクリプトを検討
- または、フィールドは残しても問題ないことを確認

## 総合評価

**要修正**

### 修正必須項目
1. openFgaMigrateRunner.ts: PhysicalResourceIdにテナント識別子を追加
2. openFgaSchemaInitializer.ts: エラー時のPhysicalResourceId判定ロジックを修正
3. openFgaMigrateRunner.ts: 冪等性判定ロジックの見直し（OpenFGA/goose仕様の確認が必要）

### 修正推奨項目
1. openFgaMigrateRunner.ts: タイムアウト時のECSタスク停止処理を追加
2. openFgaSchemaInitializer.ts: Update時のStoreId抽出にバリデーション追加
3. openFgaMigrateRunner.ts: fetch APIのエラーハンドリング強化
4. package.json: 削除された依存関係が他のファイルで使用されていないか確認
5. Lambda実行時間とタスク待機時間のバランス調整

### 全体的な評価
カスタムリソースの実装自体は適切な構造ですが、エッジケースでのエラーハンドリングと冪等性保証に改善の余地があります。特に、PhysicalResourceIdの管理とエラー時の挙動については、CloudFormationのベストプラクティスに従った修正が必要です。

**良い点**:
- CloudFormationカスタムリソースの基本的な構造は適切
- ログ出力が充実しており、トラブルシューティングしやすい
- OpenFGA公式推奨のデプロイパターンに従っている

**改善が必要な点**:
- エラーハンドリングの網羅性
- 冪等性の保証ロジック
- リソース識別子の一貫性
