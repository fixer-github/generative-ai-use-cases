# レビュー結果: CDK Tenant Payment Gateway Stack

## 担当ファイル
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/stacks/tenant/tenant-payment-gateway-stack.ts`

## 重大な問題（Critical）

### 1. Webhook受信エンドポイントが未実装
**場所**: スタック全体
**問題内容**:
- PaymentGatewayスタックでは、Stripe/Apple/Googleからのwebhookを受信するためのAPI GatewayやLambda関数が一切定義されていない
- EventBridgeバスのみが定義されているが、イベントを発行する入口が存在しない
- Webhookエンドポイントがなければ、決済プラットフォームからの通知を受け取ることができない

**影響**:
- 決済システムとの連携が機能しない
- Webhook通知が受信できないため、購入完了/キャンセル等のイベントが処理できない

**推奨対応**:
- API Gateway + Lambda構成でWebhook受信エンドポイントを追加
- 各プラットフォーム（Stripe/Apple/Google）ごとにエンドポイントを分離
- 受信したWebhookをDynamoDBに保存し、EventBridgeに発行する処理を実装

### 2. Webhook署名検証の実装が不在
**場所**: スタック全体
**問題内容**:
- Webhook受信時の署名検証機能が実装されていない
- Stripeのwebhook署名検証にはシークレットが必要だが、その検証ロジックを実行するLambda関数が存在しない
- 署名検証なしではなりすましリクエストを受け入れてしまう重大なセキュリティリスクがある

**影響**:
- 悪意のある第三者が偽のWebhookリクエストを送信できる
- 不正な課金イベントや購入イベントが処理される可能性

**推奨対応**:
- Webhook受信Lambda内で署名検証を必須化
- Stripe: `stripe.webhooks.constructEvent()` を使用した署名検証
- Apple: JWS署名の検証
- Google: Google Public Keyを使用した検証

### 3. シークレット値が平文でテンプレートに埋め込まれている
**場所**: 行127-170
**問題内容**:
```typescript
generateSecretString: {
  secretStringTemplate: JSON.stringify({
    apiKey: 'REPLACE_WITH_ACTUAL_STRIPE_API_KEY',
    webhookSecret: 'REPLACE_WITH_ACTUAL_WEBHOOK_SECRET',
  }),
  generateStringKey: 'placeholder',
}
```
- ダミー値とはいえ、シークレット構造がコードに記述されている
- `generateSecretString`の使い方が不適切（本来の用途はランダム値生成）
- 実際のシークレット値は手動設定を想定しているが、その運用フローが不明確

**影響**:
- シークレット管理の運用が不明確でセキュリティリスク
- 初期デプロイ後にシークレット値を手動更新する必要があるが、その手順が文書化されていない

**推奨対応**:
- `generateSecretString`を使用せず、空のシークレットを作成
- デプロイ後にAWS CLI/Consoleで値を設定する手順を文書化
- または、外部パラメータストア（SSM Parameter Store等）から値を取得する仕組みを検討

## 警告レベルの問題（Warning）

### 4. エラーハンドリング機構の欠如
**場所**: スタック全体
**問題内容**:
- Webhook処理に失敗した場合のリトライ機構がない
- Dead Letter Queue (DLQ) の設定がない
- EventBridgeからの処理失敗時のエラーハンドリングが未定義

**影響**:
- Webhook処理が失敗した場合、イベントが失われる可能性
- デバッグやトラブルシューティングが困難

**推奨対応**:
- EventBridgeルールにDLQを設定
- Lambda関数の非同期呼び出しにDLQとリトライ設定を追加
- CloudWatch Alarmsで処理失敗を監視

### 5. EventBusの命名規則と用途が不明確
**場所**: 行115-122
**問題内容**:
```typescript
this.eventBus =
  eventBusName === 'default'
    ? events.EventBus.fromEventBusName(this, 'EventBus', 'default')
    : new events.EventBus(this, 'TenantEventBus', {
        eventBusName: `${tenantId}-payment-gateway-events`,
      });
```
- デフォルトEventBusを使用するか専用EventBusを使用するかの判断基準が不明
- テナント分離の観点から、専用EventBusを使用すべき場面で`default`が使われる可能性
- EventBusの選択がセキュリティやコスト、運用に与える影響の説明がない

**影響**:
- マルチテナント環境でイベントが混在する可能性
- セキュリティ境界が不明確

**推奨対応**:
- テナントごとに専用EventBusを作成することを必須化
- または、defaultを使用する明確な理由を文書化

### 6. DynamoDBテーブルのキャパシティ設計が未検証
**場所**: tenant-payment-gateway-database.ts 行37
**問題内容**:
```typescript
billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
```
- PAY_PER_REQUESTモードは小規模なトラフィックには適切だが、大量のWebhookトラフィックでコストが高騰する可能性
- Webhook受信のトラフィックパターン（burst、sustained）が考慮されていない
- Provisioned Capacityとの比較検討が行われていない

**影響**:
- 予期しないコスト増加
- 大量のWebhook受信時のパフォーマンス問題

**推奨対応**:
- 想定トラフィック量に基づいたキャパシティ設計
- Provisioned Capacityとのコスト比較
- Auto Scalingの検討

### 7. TTL設定の値が未定義
**場所**: tenant-payment-gateway-database.ts 行38, 64
**問題内容**:
```typescript
timeToLiveAttribute: 'ttl',
```
- TTL属性名は定義されているが、実際のTTL値（何日後に削除するか）がアプリケーションレベルで未定義
- Webhook履歴の保持期間ポリシーが不明確

**影響**:
- データ保持期間が運用ポリシーと不整合の可能性
- コンプライアンス要件を満たせない可能性

**推奨対応**:
- Webhook履歴の保持期間を明確に定義（例: 90日）
- Lambda関数でレコード作成時にTTL値を適切に設定するロジックを実装

## 軽微な問題・改善提案（Info）

### 8. CfnOutputのexportNameが長すぎる可能性
**場所**: 行176-244
**問題内容**:
```typescript
exportName: `${this.stackName}-WebhookEventTableArn`,
```
- `this.stackName`が長い場合、exportName（最大255文字）の制限に抵触する可能性
- スタック名に環境とテナントIDが含まれるため、長い名前になりやすい

**影響**:
- デプロイ失敗の可能性（軽微）

**推奨対応**:
- exportNameを短縮するか、長さチェックを追加

### 9. Point-in-Time Recoveryの設定がテーブル間で不整合
**場所**: tenant-payment-gateway-database.ts 行40
**問題内容**:
- WebhookEventTableにはPITRが有効（行40: `pointInTimeRecovery: true`）
- ReceiptCacheTableにはPITR設定がない（デフォルトでfalse）
- 両テーブルとも決済データを扱うため、同等の保護レベルが必要

**影響**:
- ReceiptCacheTableのデータ損失時に復旧できない

**推奨対応**:
- ReceiptCacheTableにも`pointInTimeRecovery: true`を追加
- または、キャッシュデータのため不要と判断した理由を文書化

### 10. GSIのキー設計の妥当性が不明
**場所**: tenant-payment-gateway-database.ts 行44-54
**問題内容**:
```typescript
indexName: 'PlatformTypeIndex',
partitionKey: { name: 'platform_type', type: dynamodb.AttributeType.STRING },
sortKey: { name: 'received_at', type: dynamodb.AttributeType.STRING },
```
- `received_at`をSTRING型で定義しているが、ISO8601文字列を想定しているのか、UNIX timestampを想定しているのか不明
- 時刻での範囲検索を行う場合、NUMBER型の方が効率的な場合がある
- プラットフォームごとのクエリユースケースが明確に示されていない

**影響**:
- クエリパフォーマンスが最適でない可能性

**推奨対応**:
- `received_at`のデータ型とフォーマットを明確に定義
- GSIを使用するクエリパターンを文書化

### 11. シークレットの作成がオプショナルだが、デフォルト値が不適切
**場所**: 行22-39
**問題内容**:
```typescript
readonly createStripeSecrets?: boolean;  // @default false
readonly createAppleSecrets?: boolean;   // @default false
readonly createGoogleSecrets?: boolean;  // @default false
```
- デフォルトでシークレットが作成されないため、PaymentGatewayスタックをデプロイしてもシークレットが存在しない
- Webhook受信Lambda（未実装）がシークレットにアクセスしようとすると実行時エラーになる

**影響**:
- デプロイ後の初期設定が煩雑
- 設定漏れのリスク

**推奨対応**:
- 使用するプラットフォームのシークレットはデフォルトで作成
- または、必須パラメータとして明示的に指定させる

### 12. スタックの説明（description）が未使用
**場所**: 行45-46, 49
**問題内容**:
```typescript
readonly description?: string;
```
- `description`プロパティが定義されているが、実際にはStack constructorに渡されていない
- CloudFormationスタックの説明として表示されない

**影響**:
- AWSコンソールでスタックの用途が不明確（軽微）

**推奨対応**:
```typescript
super(scope, id, {
  ...props,
  description: props?.description || `Payment Gateway resources for tenant ${tenantId}`,
});
```

### 13. テナントIDのバリデーションが一貫していない
**場所**: 行96-99
**問題内容**:
```typescript
allowedPattern: '^[a-zA-Z0-9-]+$',
```
- 他のスタック（TenantDynamoDBStack等）と同じパターンだが、最小/最大長の制約がない
- ハイフン（`-`）の連続や先頭/末尾のハイフンが許可されている

**影響**:
- 無効なテナントIDが受け入れられる可能性（軽微）

**推奨対応**:
- より厳格なパターン（例: `^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]$`）を使用
- または、既存スタックと整合性を保つことを優先

### 14. タグ付けは適切だが、Costタグがない
**場所**: 行245-247
**問題内容**:
```typescript
cdk.Tags.of(this).add('TenantId', tenantId);
cdk.Tags.of(this).add('Environment', environment);
cdk.Tags.of(this).add('Service', 'PaymentGateway');
```
- コスト配分のための`CostCenter`や`Owner`タグがない
- 他のAWSリソースと統一されたタグ戦略がドキュメント化されていない

**影響**:
- コスト分析の粒度が粗い（軽微）

**推奨対応**:
- 組織のタグ戦略に従ったタグを追加
- または、現状のタグで十分と判断した理由を文書化

## 総合評価

**要修正**

### 評価理由

1. **重大な問題（Critical）が3件**:
   - Webhook受信エンドポイントが未実装
   - Webhook署名検証の実装が不在
   - シークレット管理が不適切

2. **警告レベル（Warning）が4件**:
   - エラーハンドリング機構の欠如
   - EventBusの用途不明確
   - キャパシティ設計未検証
   - TTL設定が未定義

3. **Payment Gatewayとしての機能が不完全**:
   - 現状はDynamoDBテーブルとSecretsを作成するのみ
   - 実際のWebhook受信・処理機能が欠落
   - セキュリティ要件（署名検証）が未実装

### 必須対応事項

以下の対応が完了するまで、本スタックは本番環境で使用できません:

1. **Webhook受信API Gateway + Lambda関数の追加**
   - `/webhook/stripe`, `/webhook/apple`, `/webhook/google` エンドポイント
   - 各プラットフォームの署名検証ロジック
   - DynamoDBへの保存とEventBridge発行

2. **シークレット管理の改善**
   - 平文テンプレートの削除
   - セキュアな初期設定手順の文書化

3. **エラーハンドリングとモニタリングの実装**
   - DLQ設定
   - CloudWatch Alarms
   - ログ記録

### 良い点

- DynamoDBテーブル設計は概ね適切（GSI、TTL属性など）
- 他のスタックと一貫したスタック構造
- テナント分離のアーキテクチャ
- CfnOutputによる適切な値のエクスポート

### 次のステップ

1. Webhook受信機能の設計・実装
2. セキュリティレビュー（署名検証、IAMポリシー）
3. 運用手順書の作成（シークレット設定、モニタリング）
4. 統合テストの実装
