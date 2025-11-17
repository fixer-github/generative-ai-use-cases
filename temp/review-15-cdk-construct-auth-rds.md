# レビュー結果: CDK Construct - Authorization & RDS

## 担当ファイル
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/authorization-system.ts` (新規作成)
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/tenant-rds.ts` (新規作成)
- `/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/database.ts` (変更)

---

## 重大な問題（Critical）

### 1. DynamoDBテーブルの暗号化設定が削除されている
**ファイル**: `database.ts`
**問題箇所**:
- Line 27: `table` の暗号化設定削除
- Line 48: `statsTable` の暗号化設定削除
- Line 62, 86: `assistantTable`, `assistantMessagesTable` の暗号化設定削除

**詳細**:
```typescript
// 削除された設定
- encryption: ddb.TableEncryption.AWS_MANAGED,
```

**影響**:
- DynamoDBのデフォルト暗号化はAWS管理キーによる暗号化が適用されるが、明示的な設定がないとコンプライアンス監査で指摘される可能性がある
- セキュリティ要件が厳しい環境（HIPAA、PCI DSS等）では明示的な暗号化設定が必須

**推奨対応**:
- 明示的に `encryption: ddb.TableEncryption.AWS_MANAGED` を追加する
- より高いセキュリティが必要な場合は `ddb.TableEncryption.CUSTOMER_MANAGED` を検討

---

### 2. Authorization SystemのDynamoDBテーブルに暗号化設定とバックアップ設定が未設定
**ファイル**: `authorization-system.ts`
**問題箇所**:
- Line 114-126: `usageCounterTable` に暗号化設定なし
- Line 157-169: `permissionGrantTable` に暗号化設定なし
- 両テーブルに `pointInTimeRecovery` 設定なし

**詳細**:
```typescript
// 欠落している設定
this.usageCounterTable = new dynamodb.Table(this, 'UsageCounterTable', {
  // ... 既存の設定
  // encryption: dynamodb.TableEncryption.AWS_MANAGED, // 追加すべき
  // pointInTimeRecovery: true, // 追加すべき
});
```

**影響**:
- 権限データと使用量データは機密性の高いビジネスデータ
- バックアップがない場合、データ損失時の復旧が不可能
- テナント別課金の根拠となるデータが失われるとビジネス影響が大きい

**推奨対応**:
- `encryption: dynamodb.TableEncryption.AWS_MANAGED` を追加
- `pointInTimeRecovery: true` を追加
- 必要に応じて `removalPolicy: cdk.RemovalPolicy.RETAIN` を本番環境で設定

---

### 3. IAM権限のワイルドカード使用が過度に広範
**ファイル**: `authorization-system.ts`
**問題箇所**:
- Line 317: AssumeRole権限で `arn:aws:iam::*:role/TenantRole-*` を許可
- Line 334: API Gateway権限で `arn:aws:execute-api:*:*:*/prod/*` を許可
- Line 351-353: SSM Parameter権限でワイルドカードパス使用

**詳細**:
```typescript
// 過度に広範な権限
resources: ['arn:aws:iam::*:role/TenantRole-*'], // 全アカウント
resources: ['arn:aws:execute-api:*:*:*/prod/*'], // 全リージョン・全アカウント
resources: [
  `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiEndpoint`,
  // ... 全テナント
],
```

**影響**:
- 最小権限の原則に違反
- 意図しないリソースへのアクセスが可能になる
- セキュリティ監査で指摘される可能性が高い

**推奨対応**:
```typescript
// 特定のアカウントとリージョンに限定
resources: [
  `arn:aws:iam::${cdk.Stack.of(this).account}:role/TenantRole-*`
],
resources: [
  `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:*/prod/*`
],
// テナントIDが判明している場合は具体的に指定
resources: [
  `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/genu-gaixer/tenants/${props.tenantId}/*`,
],
```

---

## 警告レベルの問題（Warning）

### 4. RDSのKMS暗号化キーが未指定（デフォルトキー使用）
**ファイル**: `tenant-rds.ts`
**問題箇所**: Line 206

**詳細**:
```typescript
// 現在の設定
storageEncrypted: true,  // デフォルトのAWS管理キーを使用

// 推奨設定
storageEncrypted: true,
storageEncryptionKey: kmsKey, // カスタマー管理キーを明示
```

**影響**:
- AWS管理キーでも暗号化はされるが、キーローテーションやアクセス制御の柔軟性が低い
- 複数テナントで同じキーを使うとテナント分離が不完全になる
- コンプライアンス要件（PCI DSS、GDPR等）によっては不十分

**推奨対応**:
- テナント専用のKMSキーを作成し、明示的に指定
- キーポリシーでテナントのIAMロールのみアクセス可能に設定
- キーの自動ローテーションを有効化

---

### 5. RDSのバックアップウィンドウが固定で重複リスクあり
**ファイル**: `tenant-rds.ts`
**問題箇所**: Line 208

**詳細**:
```typescript
preferredBackupWindow: '03:00-04:00', // UTC - 全テナントで同じ時間
```

**影響**:
- 複数テナントのRDSインスタンスが同時にバックアップを実行
- AWS APIのレート制限に達する可能性
- バックアップ時のパフォーマンス低下が全テナントで同時発生

**推奨対応**:
- テナントIDをハッシュ化して時間帯を分散
- または、バックアップウィンドウをpropsで受け取り外部で制御

---

### 6. Lambda関数の環境変数にテーブル名等の情報が未設定
**ファイル**: `authorization-system.ts`
**問題箇所**: Line 193-195

**詳細**:
```typescript
const commonEnvironment = {
  ENVIRONMENT: environment,
  // テーブル名やリージョン情報が含まれていない
};
```

**影響**:
- Lambda関数内でテーブル名をハードコードするか、別の方法で取得する必要がある
- 環境による設定の差異が発生しやすい
- デバッグが困難になる

**推奨対応**:
```typescript
const commonEnvironment = {
  ENVIRONMENT: environment,
  USAGE_COUNTER_TABLE_NAME: this.usageCounterTable.tableName,
  PERMISSION_GRANT_TABLE_NAME: this.permissionGrantTable.tableName,
  TENANT_ID: props.tenantId,
  AWS_REGION: cdk.Stack.of(this).region,
};
```

---

### 7. RDSセキュリティグループがVPC全体からの接続を許可
**ファイル**: `tenant-rds.ts`
**問題箇所**: Line 157-162

**詳細**:
```typescript
this.securityGroup.addIngressRule(
  ec2.Peer.ipv4(props.vpc.vpcCidrBlock),  // VPC全体
  ec2.Port.tcp(5432),
  'Allow PostgreSQL access from within VPC'
);
```

**影響**:
- VPC内の全リソースがRDSにアクセス可能
- 最小権限の原則に違反
- 不要なアクセスパスが存在

**推奨対応**:
- デフォルトルールは削除し、`grantAccess()` メソッド経由でのみアクセスを許可
- または、プライベートサブネットのCIDRのみに限定

---

### 8. EventBridge Ruleの命名が環境依存のみでテナント情報がない
**ファイル**: `authorization-system.ts`
**問題箇所**: Line 384, 409

**詳細**:
```typescript
ruleName: `DailyUsageCountReset-${environment}`,
ruleName: `MonthlyUsageCountReset-${environment}`,
```

**影響**:
- 複数テナントで同じルール名が使用される
- 単一アカウントで複数テナントをデプロイする場合に名前衝突

**推奨対応**:
```typescript
ruleName: `DailyUsageCountReset-${environment}-${sanitizedTenantId}`,
ruleName: `MonthlyUsageCountReset-${environment}-${sanitizedTenantId}`,
```

---

## 軽微な問題・改善提案（Info）

### 9. RDSの読み取りレプリカ構成が考慮されていない
**ファイル**: `tenant-rds.ts`

**提案**:
- 将来的な読み取り負荷の増大に備え、読み取りレプリカを追加するオプションを用意
- `readonly readReplicas?: number` プロパティを追加

---

### 10. パフォーマンスInsightsの保持期間が本番以外で短い
**ファイル**: `tenant-rds.ts`
**問題箇所**: Line 213-216

**詳細**:
```typescript
performanceInsightRetention:
  environment === 'dev'
    ? rds.PerformanceInsightRetention.DEFAULT  // 7日間
    : rds.PerformanceInsightRetention.LONG_TERM  // 731日間
```

**提案**:
- stagingでも一定期間の保持（例: 31日間）を設定
- パフォーマンス問題の調査に十分な期間を確保

---

### 11. Lambda関数のリザーブド同時実行数が未設定
**ファイル**: `authorization-system.ts`

**提案**:
- 重要な関数（checkPermission等）にリザーブド同時実行数を設定
- アカウント全体の同時実行数上限の保護

```typescript
reservedConcurrentExecutions: 100,  // 例
```

---

### 12. DynamoDBテーブルのGSIにプロジェクションタイプALLを使用
**ファイル**: `authorization-system.ts`
**問題箇所**: Line 133-140, 143-154, 176-187

**詳細**:
```typescript
projectionType: dynamodb.ProjectionType.ALL,  // 全属性を複製
```

**影響**:
- ストレージコストが増加
- 書き込みスループットも増加

**提案**:
- 実際にクエリで必要な属性のみを指定（KEYS_ONLY or INCLUDE）
- ただし、柔軟性とのトレードオフを考慮

---

### 13. RDSのメンテナンスウィンドウが未指定
**ファイル**: `tenant-rds.ts`

**提案**:
```typescript
preferredMaintenanceWindow: 'sun:05:00-sun:06:00', // 例: 日曜日の深夜
```

- メンテナンスウィンドウを明示的に設定し、サービスへの影響を最小化

---

### 14. CloudWatch Alarmsが未設定
**ファイル**: `tenant-rds.ts`, `authorization-system.ts`

**提案**:
- RDSのCPU使用率、接続数、ストレージ容量のアラーム設定
- DynamoDBの読み取り/書き込みスロットリングのアラーム設定
- Lambda関数のエラー率、実行時間のアラーム設定

---

### 15. database.tsでRemovalPolicyがDESTROYに変更されている
**ファイル**: `database.ts`
**問題箇所**: Line 63, 87

**詳細**:
```typescript
removalPolicy: RemovalPolicy.DESTROY,  // 本番環境で危険
```

**影響**:
- スタック削除時にデータが完全に削除される
- 誤操作による重大なデータ損失リスク

**推奨対応**:
- 環境変数で制御するか、本番環境では `RemovalPolicy.RETAIN` を使用
```typescript
removalPolicy: environment === 'prod'
  ? RemovalPolicy.RETAIN
  : RemovalPolicy.DESTROY,
```

---

### 16. SSMパラメータの暗号化が未設定
**ファイル**: `tenant-rds.ts`
**問題箇所**: Line 236-300

**詳細**:
```typescript
new ssm.StringParameter(this, 'RdsEndpointParameter', {
  // ... 暗号化設定なし
});
```

**提案**:
- 機密性の高い情報（エンドポイント、シークレットARN等）は暗号化推奨
```typescript
new ssm.StringParameter(this, 'RdsSecretArnParameter', {
  parameterName: `/genu-gaixer/tenants/${this.tenantId}/rdsSecretArn`,
  stringValue: this.secret.secretArn,
  tier: ssm.ParameterTier.STANDARD,
  type: ssm.ParameterType.SECURE_STRING,  // 追加
});
```

---

### 17. コスト最適化: DynamoDBのGSI数が多い
**ファイル**: `authorization-system.ts`

**詳細**:
- `usageCounterTable`: 2つのGSI
- `permissionGrantTable`: 1つのGSI

**提案**:
- GSIの使用状況をモニタリング
- 使用頻度が低いGSIは統合またはクエリ方法の見直しを検討

---

### 18. コスト最適化: RDSの自動停止機能が未設定（dev環境）
**ファイル**: `tenant-rds.ts`

**提案**:
- dev環境向けにScheduled Actionsで夜間の自動停止/起動を設定
- または、AWS Instance Schedulerの利用を検討

---

### 19. AuthorizationSystemのpropsでtenantRoleArnが未使用
**ファイル**: `authorization-system.ts`
**問題箇所**: Line 32

**詳細**:
```typescript
readonly tenantRoleArn: string;  // 定義されているが使用されていない
```

**提案**:
- AssumeRole権限のリソースARNを `props.tenantRoleArn` で制限
- または、未使用であれば削除

---

### 20. database.tsからtenantVisibilityIndexが削除されている
**ファイル**: `database.ts`

**詳細**:
- `tenantVisibilityIndexName` とそのGSIが完全に削除されている
- 既存のコードでこのインデックスを使用している可能性

**推奨対応**:
- 既存コードでの使用状況を確認
- 使用している場合は削除を取り消すか、代替クエリ方法を実装

---

## 総合評価

**要修正**

### 理由:
1. **セキュリティ**: DynamoDB暗号化設定の削除とIAM権限のワイルドカード使用が重大なセキュリティリスク
2. **データ保護**: Authorization SystemのDynamoDBテーブルにバックアップ設定がなく、ビジネスクリティカルなデータの損失リスク
3. **運用性**: 環境変数不足、命名衝突、RemovalPolicy設定により運用上の問題が発生する可能性

### 優先対応項目（Critical）:
1. DynamoDB暗号化設定の復元・追加（database.ts, authorization-system.ts）
2. DynamoDBのポイントインタイムリカバリ設定（authorization-system.ts）
3. IAM権限のワイルドカード制限（authorization-system.ts）
4. RemovalPolicyの環境別制御（database.ts）

### 良い点:
1. RDSのセキュリティ設定（暗号化、IAM認証、プライベートサブネット）は適切
2. マルチAZ、自動バックアップ、パフォーマンスInsightsなどの本番運用を考慮した設定
3. SSMパラメータストアを使用したテナント別設定管理の実装
4. EventBridge Schedulerによる自動リセット機能の実装
5. 適切なタグ付けとリソースネーミング規則

### 次のステップ:
1. Critical問題の修正
2. Warning問題のレビューと対応判断
3. CloudWatch Alarms、メトリクス設定の追加
4. テナント別KMSキーの設計・実装
5. コスト最適化施策の検討・実装
