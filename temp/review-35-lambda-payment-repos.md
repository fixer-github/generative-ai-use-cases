# レビュー結果: Lambda Payment-Gateway - Repositories

## 担当ファイル
- `/packages/cdk/lambda/billing/payment-gateway/repositories/receiptCacheRepository.ts`
- `/packages/cdk/lambda/billing/payment-gateway/repositories/types.ts`
- `/packages/cdk/lambda/billing/payment-gateway/repositories/webhookEventRepository.ts`

## 重大な問題（Critical）

### 1. WebhookEventRepository.findByDateRange のクエリロジックに致命的な欠陥

**ファイル**: `webhookEventRepository.ts` (57-60行目)

**問題点**:
```typescript
const indexName = platformType ? 'PlatformTypeIndex' : undefined;
const keyConditionExpression = platformType
  ? 'platform_type = :platform_type AND received_at BETWEEN :start_date AND :end_date'
  : 'received_at BETWEEN :start_date AND :end_date';
```

`platformType`が指定されていない場合、`indexName`が`undefined`になり、KeyConditionExpressionで`received_at`を使用しようとしています。しかし、**DynamoDBのテーブルのプライマリキーは`event_id`**であり、`received_at`はパーティションキーではありません。そのため、このクエリは実行時エラーになります。

**影響**:
- `platformType`なしで`findByDateRange`を呼び出すと、必ず失敗する
- 日付範囲での検索機能が正常に動作しない

**推奨対応**:
- `received_at`用のGSI（Global Secondary Index）を定義する必要がある
- または、platformTypeなしの場合はScan操作にフォールバックする（ただし非効率）
- または、platformTypeを必須パラメータにする

### 2. エラーハンドリングが一切ない

**ファイル**: 全ファイル

**問題点**:
- すべてのDynamoDB操作でエラーハンドリングがない
- ネットワークエラー、アクセス権限エラー、スロットリングなどが発生した場合、例外がそのまま呼び出し元に伝播する
- DynamoDBの制約違反（例: アイテムサイズ超過）のハンドリングがない

**影響**:
- 本番環境でのエラー追跡が困難
- 適切なリトライロジックがないため、一時的なエラーで処理が失敗する可能性
- ログに詳細情報が記録されない

**推奨対応**:
- try-catchブロックでDynamoDB操作をラップ
- エラーの種類に応じた適切な処理（リトライ、ログ記録、カスタムエラーのスロー）
- 特にConditionalCheckFailedExceptionやProvisionedThroughputExceededExceptionへの対応

## 警告レベルの問題（Warning）

### 1. ReceiptCacheRepository.save で上書き保存されるリスク

**ファイル**: `receiptCacheRepository.ts` (38-43行目)

**問題点**:
```typescript
const command = new PutItemCommand({
  TableName: this.tableName,
  Item: marshall(cache, { removeUndefinedValues: true }),
});
```

`PutItemCommand`は既存のアイテムを無条件で上書きします。同じレシートハッシュに対して複数の検証結果が保存される場合、古い結果が警告なく上書きされます。

**影響**:
- 並行リクエストで検証結果が競合する可能性
- デバッグ時に問題の追跡が困難

**推奨対応**:
- `ConditionExpression`を使用して、既存アイテムがない場合のみ保存
- または、既存アイテムがある場合は更新しない（キャッシュヒット扱い）

### 2. WebhookEventRepository.save も同様の上書きリスク

**ファイル**: `webhookEventRepository.ts` (22-28行目)

**問題点**:
同じ`event_id`のイベントが複数回保存される場合、重複チェックの意味がなくなります。

**影響**:
- Webhookの重複処理防止機能が効かない可能性
- イベント履歴の整合性が保証されない

**推奨対応**:
- `ConditionExpression: 'attribute_not_exists(event_id)'`を追加
- 既存イベントがある場合は`ConditionalCheckFailedException`をキャッチして適切に処理

### 3. ReceiptCache.ttl の手動チェックは不要

**ファイル**: `receiptCacheRepository.ts` (65-69行目)

**問題点**:
```typescript
// TTLチェック（DynamoDBのTTL削除は遅延があるため、手動でもチェック）
const now = Math.floor(Date.now() / 1000);
if (cache.ttl < now) {
  return null;
}
```

この実装自体は問題ありませんが、コメントに「遅延があるため」とある通り、DynamoDBのTTL削除は48時間遅延する可能性があります。手動チェックは良い防御策ですが、この処理の存在により、実際にはTTL機能自体が必要かどうか再検討の余地があります。

**影響**:
- TTL設定とコードの両方でチェックする二重管理
- TTL設定が機能していなくてもコードで補完されるため、インフラ側の問題が見えにくい

**推奨対応**:
- 現状のままでも問題ないが、TTLは主にストレージコスト削減のため、と明確化
- または、TTL設定を削除して完全にアプリケーションロジックで管理

### 4. 型定義の柔軟性が高すぎる

**ファイル**: `types.ts` (8, 19行目)

**問題点**:
```typescript
event_data: Record<string, any>;
```
```typescript
[key: string]: any;
```

`any`型の使用により、型安全性が失われています。

**影響**:
- コンパイル時の型チェックが効かない
- リファクタリング時の影響範囲が不明確
- IDEの補完が効かない

**推奨対応**:
- プラットフォームごとに具体的な型を定義（StripeWebhookData、AppleReceiptData等）
- 共通フィールドを持つベース型を定義し、プラットフォーム固有の拡張を行う

## 軽微な問題・改善提案（Info）

### 1. DynamoDBClientのリージョン設定が明示されていない

**ファイル**: `receiptCacheRepository.ts` (16行目), `webhookEventRepository.ts` (16行目)

**問題点**:
```typescript
this.client = client || new DynamoDBClient({});
```

空のコンフィグでクライアントを作成すると、環境変数またはAWS SDKのデフォルト設定に依存します。

**影響**:
- 開発環境と本番環境で異なるリージョンにアクセスする可能性
- 明示的な設定がないため、トラブルシューティングが困難

**推奨対応**:
- リージョンを環境変数から取得して明示的に設定
- または、クライアントの注入を必須にする（コンストラクタの`client`を必須パラメータに）

### 2. TTL値の計算ロジックが散在

**ファイル**: `receiptCacheRepository.ts` (29行目)

**問題点**:
```typescript
const ttl = Math.floor(now.getTime() / 1000) + 24 * 60 * 60; // 24時間後
```

TTLの期間（24時間）がハードコードされています。

**影響**:
- 期間の変更時に複数箇所の修正が必要になる可能性
- テストで異なるTTLを使用したい場合に柔軟性がない

**推奨対応**:
- TTL期間をコンストラクタパラメータまたはクラス定数として定義
- または、設定ファイルから読み込む

### 3. ハッシュアルゴリズムの選択理由が不明

**ファイル**: `receiptCacheRepository.ts` (81-83行目)

**問題点**:
SHA256を使用していますが、選択理由が不明です。レシートのプライバシー保護が目的であれば適切ですが、単なる重複排除が目的であればオーバースペックの可能性があります。

**影響**:
- パフォーマンスへの若干の影響（SHA256は暗号学的ハッシュ関数のため計算コストが高い）
- 設計意図が不明確

**推奨対応**:
- コメントで選択理由を明記（セキュリティ要件、プライバシー保護など）
- 単なる重複排除が目的なら、より高速なハッシュ関数（MurmurHash等）の検討

### 4. コンストラクタのパラメータ順序が不統一

**ファイル**: 両リポジトリ

**問題点**:
両方のリポジトリで`tableName`が必須、`client`がオプショナルですが、この設計パターンが一貫していることは良いです。ただし、将来的に追加の設定が必要になった場合、パラメータが増えすぎる可能性があります。

**推奨対応**:
- 設定オブジェクトパターンの採用を検討
```typescript
constructor(config: {
  tableName: string;
  client?: DynamoDBClient;
  ttlHours?: number;
})
```

### 5. メソッド名の命名規則

**ファイル**: 両リポジトリ

**問題点**:
- `findByReceiptHash`: レシートを直接渡しているのに"Hash"を含む命名
- `findByEventId`: 一貫性は良いが、`get`との使い分けが不明確（単一取得なので`getByEventId`でも良い）

**影響**:
- APIの意図が若干分かりにくい
- `find`は通常複数の結果を返す操作を連想させる

**推奨対応**:
- `findByReceiptHash` → `findByReceipt`（内部でハッシュ化するため）
- 単一取得の場合は`get`、複数取得の場合は`find`で統一を検討

### 6. ISO 8601フォーマットのバリデーションがない

**ファイル**: `types.ts` (5, 27行目)

**問題点**:
`received_at`と`verified_at`がISO 8601形式を期待していますが、型定義では単なる`string`です。

**影響**:
- 無効なフォーマットが保存される可能性
- クエリやソート時に問題が発生する可能性

**推奨対応**:
- 保存前にフォーマットをバリデーション
- または、Date型のブランド型（Branded Type）を定義
- または、`toISOString()`を呼び出す前にDateオブジェクトであることを確認

### 7. VerificationResult.cached フィールドの型定義の一貫性

**ファイル**: `types.ts` (21行目), `receiptCacheRepository.ts` (74行目)

**問題点**:
`cached`フィールドはオプショナル(`cached?: boolean`)ですが、実装では常に`true`を設定しています。`false`になるケースがないため、フィールドの存在自体で判断できます。

**影響**:
- 型定義と実装の不一致
- `cached === false`と`cached === undefined`の区別が曖昧

**推奨対応**:
- `cached?: true`に変更（trueのみ許可）
- または、`cached: boolean`に変更し、キャッシュミス時も明示的に`false`を設定

### 8. DynamoDBのページネーション対応がない

**ファイル**: `webhookEventRepository.ts` (52-85行目)

**問題点**:
`findByDateRange`メソッドは、1MB以上の結果を返す場合にページネーションが必要ですが、実装されていません。

**影響**:
- 大量のイベントがある場合、すべてを取得できない
- メモリ使用量が不明確

**推奨対応**:
- `LastEvaluatedKey`を使用したページネーション対応
- または、最大取得件数を制限して明示的に示す
- または、カーソルベースのAPIに変更

### 9. marshallオプションの一貫性

**ファイル**: 両リポジトリ

**問題点**:
`save`メソッドでは`removeUndefinedValues: true`を指定していますが、他の操作では指定されていません。

**影響**:
- 動作の一貫性に欠ける
- `undefined`値の扱いが操作によって異なる可能性

**推奨対応**:
- クラスレベルでmarshallのデフォルトオプションを定義
- すべての操作で一貫したオプションを使用

## 総合評価

**要修正**

### 理由:
1. **Critical**: `WebhookEventRepository.findByDateRange`のクエリロジックに致命的な欠陥があり、実行時エラーになる
2. **Critical**: エラーハンドリングが一切なく、本番環境での信頼性に問題がある
3. **Warning**: 重複防止のための`ConditionExpression`が実装されていない

### 修正優先度:
1. **最優先**: findByDateRangeのクエリロジック修正（GSI追加またはAPI仕様変更）
2. **高**: エラーハンドリングの実装（最低限try-catch、理想的にはリトライロジック）
3. **高**: save操作での重複チェック（ConditionExpression追加）
4. **中**: 型定義の改善（anyの削減）
5. **低**: その他のInfo項目

### 肯定的な点:
- レシートキャッシュの基本的なロジックは適切（ハッシュ化、TTL設定）
- Repository パターンが適切に適用されている
- コンストラクタでのDI対応により、テスタビリティが高い
- コード全体の構造は理解しやすく、保守性は高い

レビュー実施日時: 2025-11-17
