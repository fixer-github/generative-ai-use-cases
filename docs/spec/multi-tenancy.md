# AWS アカウントレベル分離マルチテナンシー実装仕様書

## 概要

テナント毎に独立したAWSアカウントを持つアカウントレベル分離パターンの段階的実装仕様を定義します。プロジェクトが未出荷のため、各フェーズで非推奨コードを完全に削除し、クリーンなアーキテクチャを構築します。

### 段階的実装アプローチ

- **Phase 1**: テナント管理基盤構築と非推奨コード削除
  - DynamoDB Tenantsテーブルによるテナント情報管理
  - AssumeRoleWithWebIdentity認証フローの実装
  - ABACパターンコードの完全削除

- **Phase 2**: クロスアカウント分離機能の追加
  - テナント専用AWSアカウントへの分離機能
  - Phase 1基盤へのクロスアカウント連携機能追加

## 目的

- **完全なテナント分離**: テナント間のデータ・リソース完全分離によるセキュリティ強化
- **運用管理の効率化**: コントロールプレーンからの一元的なプロビジョニング・管理
- **コンプライアンス要件対応**: 規制要件に対応した強固な分離アーキテクチャ
- **スケーラビリティ**: テナント数の増加に対応可能なアーキテクチャ

## 現状アーキテクチャ分析

### 現在のABACパターン

```
┌─────────────────────────────────────────────────────────────┐
│ Control Plane Account (現在のメインアカウント)                │
├─────────────────────────────────────────────────────────────┤
│ Cognito User Pool + Identity Pool                           │
│ ├─ カスタム属性: custom:tenant_id                           │
│ ├─ Principal Tag: TenantID = custom:tenant_id               │
│ └─ ABAC Policy: ${aws:PrincipalTag/TenantID}               │
│                                                             │
│ 共有リソース (テナント固有の命名規則)                      │
│ ├─ S3: bucket-env-tenant-${tenantId}-type                  │
│ ├─ DynamoDB: table-tenant-${tenantId}                      │
│ └─ IAM Policy: Principal Tag による制御                     │
└─────────────────────────────────────────────────────────────┘
```

### 現状の課題
- **制限されたセキュリティ**: 単一アカウント内でのIAM制御に依存
- **リソース名前空間の競合**: テナント数増加に伴う管理複雑化
- **監査の複雑さ**: 単一アカウント内でのテナント別監査ログ分離
- **コンプライアンス制約**: 一部の規制要件で物理的分離が要求される

## Phase 1: テナント管理基盤構築と非推奨コード削除

### Phase 1の目標
テナント管理基盤を構築し、既存のABACパターンコードを完全に削除します。クリーンなアーキテクチャで次のフェーズに向けた土台を作ります。

### Phase 1アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ Control Plane Account                                       │
├─────────────────────────────────────────────────────────────┤
│ Cognito User Pool                                           │
│ ├─ カスタム属性: custom:tenant_id                           │
│ └─ JWT Token発行                                            │
│                                                             │
│ テナント管理サービス                                       │
│ ├─ DynamoDB: Tenants（メタデータ）                        │
│ ├─ KMS: クロスアカウント情報暗号化用                      │
│ └─ Lambda: TenantManager                                    │
│                                                             │
│ AssumeRoleWithWebIdentity認証フロー                        │
│ ├─ 同一アカウント内でのロール切り替え                      │
│ └─ テナント専用IAMロール（同一アカウント内）              │
│                                                             │
│ クリーンなリソース構造                                     │
│ ├─ S3: tenant-{tenantId}-{resourceType}                    │
│ ├─ DynamoDB: tenant-{tenantId}-{tableName}                 │
│ └─ IAM Policy: シンプルなテナント制御                      │
└─────────────────────────────────────────────────────────────┘
```

### テナント情報管理システム

#### DynamoDB Table: Tenants

**テーブル構成要件:**
- **パーティションキー**: tenantId (String)
- **必須属性**:
  - tenantId: テナント識別子
  - status: テナントの状態 (active, inactive, provisioning, error)
  - region: テナントリソースのデプロイ先リージョン
  - createdAt, updatedAt: タイムスタンプ
  - metadata: テナント基本情報（企業名、連絡先等）
- **Phase 2で追加される属性**（Phase 1では未使用）:
  - accountId: テナント専用AWSアカウントID
  - encryptedCrossAccountRoleArn: KMS暗号化されたクロスアカウントロールARN

### Phase 1認証フロー

#### AssumeRoleWithWebIdentity（同一アカウント内）

```
1. User Authentication
   Client → Cognito User Pool → JWT Token (custom:tenant_id)

2. API Request
   Client → API Gateway → Lambda → TenantManager

3. Tenant Information Resolution
   Lambda → DynamoDB (Tenants) → Get tenant metadata

4. Same-Account Role Assumption
   Lambda → STS AssumeRoleWithWebIdentity
   ├─ Role ARN: arn:aws:iam::CURRENT-ACCOUNT:role/TenantRole-{tenantId}
   ├─ Web Identity Token: Cognito JWT Token
   └─ Session Tags: TenantID from JWT claims

5. Tenant Resource Access
   Lambda → Current Account Resources (S3, DynamoDB, etc.)
```

#### セキュリティ制御（Phase 1）

**テナント専用IAMロール（同一アカウント内）:**
- **ロール名**: TenantRole-{tenantId}
- **信頼関係**: cognito-identity.amazonaws.com（Federated）
- **権限**: テナント専用リソースへの制限されたアクセス
- **条件**: JWTクレームによるテナントID検証

### Phase 1の成果
- **クリーンアーキテクチャ**: ABACパターンの完全削除による簡潔な設計
- **検証可能**: AssumeRoleWithWebIdentity認証フローの安全な検証
- **拡張準備**: Phase 2でのクロスアカウント実装準備完了
- **技術的負債削除**: 非推奨コードとパターンの完全除去

### Phase 1の制約
- **セキュリティ**: 同一アカウント内での分離（Phase 2で解決）
- **監査**: アカウントレベル分離は未実現（Phase 2で解決）

## Phase 2: クロスアカウント分離アーキテクチャ

### Phase 2の目標
Phase 1で構築したクリーンなテナント管理基盤にクロスアカウント機能を追加し、テナント毎に独立したAWSアカウントでの完全分離を実現します。

### Phase 2アーキテクチャ（アカウントレベル分離パターン）

```
┌─────────────────────────────────────────────────────────────┐
│ Control Plane Account                                       │
├─────────────────────────────────────────────────────────────┤
│ Cognito User Pool + Identity Pool                           │
│ ├─ 認証・認可の一元管理                                    │
│ ├─ カスタム属性: custom:tenant_id                          │
│ └─ JWT Token 発行                                           │
│                                                             │
│ テナント管理サービス                                       │
│ ├─ DynamoDB: Tenants (メタデータ)                          │
│ ├─ KMS: クロスアカウントロールARN暗号化                    │
│ └─ Lambda: TenantManager                                    │
│                                                             │
│ プロビジョニングサービス                                   │
│ ├─ CDK Deploy: テナントアカウントへのリソース展開          │
│ ├─ CloudFormation StackSets                                │
│ └─ Cross-Account IAM Role Management                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ AssumeRole
                              │ WithWebIdentity
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Tenant Account A (123456789012)                             │
├─────────────────────────────────────────────────────────────┤
│ テナント専用リソース                                       │
│ ├─ S3 Buckets: 標準的な命名規則                           │
│ ├─ DynamoDB Tables: 標準的な命名規則                      │
│ ├─ Lambda Functions: テナント専用                          │
│ └─ CloudWatch Logs: 完全分離                               │
│                                                             │
│ Cross-Account Trust Role                                    │
│ ├─ Trust: Control Plane Identity Pool                      │
│ ├─ Permission: テナントリソースフルアクセス                │
│ └─ Condition: Principal Tag による制限                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Tenant Account B (234567890123)                             │
│ ... (同様の構成)                                           │
└─────────────────────────────────────────────────────────────┘
```

## Phase 2: テナント情報管理の機能追加

### データ構造設計

#### DynamoDB Table: Tenants（Phase 2機能追加）

**テーブル構成要件:**
- **パーティションキー**: tenantId (String)
- **必須属性**:
  - tenantId: テナント識別子
  - accountId: テナント専用AWSアカウントID
  - encryptedCrossAccountRoleArn: KMS暗号化されたクロスアカウントロールARN
  - region: テナントリソースのデプロイ先リージョン
  - status: テナントの状態 (active, inactive, provisioning, error)
  - createdAt, updatedAt: タイムスタンプ
- **オプション属性**:
  - metadata: 企業名、連絡先、デプロイ済みスタック情報等の管理メタデータ

#### KMS暗号化戦略

**KMS Key設定要件:**
- **Key Policy**: TenantManager Lambdaロールに以下の権限を付与
  - kms:Encrypt, kms:Decrypt, kms:ReEncrypt*
  - kms:GenerateDataKey*, kms:CreateGrant, kms:DescribeKey
- **Key Rotation**: 自動ローテーション有効化
- **暗号化対象データ**:
  - crossAccountRoleArn: テナントアカウントへのアクセス用IAMロールARN
  - additionalSecrets: 追加の機密情報（必要に応じて）
- **暗号化方式**: AWS KMS Envelope Encryption
- **キー管理**: コントロールプレーンアカウント内で管理

## クロスアカウントアクセスフロー

### アクセスフロー詳細

```
1. User Authentication
   Client → Cognito User Pool → JWT Token (custom:tenant_id)

2. API Request
   Client → API Gateway → Lambda → TenantManager

3. Tenant Account Resolution
   Lambda → DynamoDB (Tenants) → Get encrypted role ARN
   Lambda → KMS → Decrypt role ARN

4. Cross-Account Access
   Lambda → STS AssumeRoleWithWebIdentity
   ├─ Role ARN: arn:aws:iam::TENANT-ACCOUNT:role/TenantAccessRole
   ├─ Web Identity Token: Cognito JWT Token
   └─ Session Tags: TenantID from JWT claims

5. Tenant Resource Access
   Lambda → Tenant Account Resources (S3, DynamoDB, etc.)
```

### セキュリティ制御

#### Cognito Identity Pool設定

**Principal Tag Mapping設定要件:**
- **Identity Pool**: 既存のIdentity Pool IDを使用
- **Identity Provider**: User Pool Provider名を指定
- **Principal Tags**:
  - TenantID: JWTクレームの'custom:tenant_id'からマッピング
- **useDefaults**: false（明示的な制御のため）
- **目的**: JWTクレーム内のテナントIDをAssumeRole時のPrincipal Tagとして利用

#### テナントアカウントの信頼関係

**IAM Role Trust Policy設定要件:**
- **Principal**: cognito-identity.amazonaws.com（Federated）
- **Actions**:
  - sts:AssumeRoleWithWebIdentity（WebIdentity認証）
  - sts:TagSession（セッションタグ設定）
- **Conditions**:
  - Identity Pool ID検証: cognito-identity.amazonaws.com:aud
  - 認証状態検証: cognito-identity.amazonaws.com:amr = authenticated
  - テナントID検証: aws:PrincipalTag/TenantID = 該当テナントID
- **適用対象**: 各テナントアカウント内のクロスアカウントアクセス用IAMロール
- **セキュリティ**: テナントIDの一致確認により他テナントからのアクセスを防止

## 実装仕様

### 1. テナントアカウント管理サービス

#### TenantManager機能要件

**主要機能:**
- **getTenant**: テナントIDからテナント情報を取得
- **registerTenant**: 新しいテナント情報を登録
- **updateTenant**: テナント情報を更新
- **deactivateTenant**: テナントを無効化

**必要なAWS SDKクライアント:**
- KMSClient: 暗号化/復号化処理
- DynamoDBClient: テナント情報のデータベース操作

**環境変数:**
- TENANTS_KMS_KEY_ID: KMSキー識別子
- TENANTS_TABLE_NAME: DynamoDBテーブル名

**エラーハンドリング:**
- KMS復号化失敗時のリトライ処理
- DynamoDBアクセスエラーのハンドリング
- テナント未登録時の適切なメッセージ

### 2. クロスアカウント認証機能

#### クロスアカウント認証機能要件

**機能概要:**
- 既存のtenantCredentials.tsを更新し、クロスアカウントアクセスに対応
- Phase 1のAssumeRoleWithWebIdentityをクロスアカウント対応に拡張

**処理フロー:**
1. **JWTトークンからテナントID取得**
   - API Gateway eventからcustom:tenant_idクレームを抽出
2. **テナント情報取得**
   - TenantManagerでDynamoDBからテナント情報を取得
   - KMSでクロスアカウントロールARNを復号
3. **AssumeRoleWithWebIdentity実行**
   - JWTトークンをWebIdentityTokenとして使用
   - テナントアカウントのIAMロールをAssumeRole
4. **一時認証情報返却**

**設定パラメータ:**
- RoleSessionName: セッション識別用の一意名称
- DurationSeconds: セッション有効期間（推奨: 3600秒）
- Region: テナントアカウントのリージョンを使用

**エラーハンドリング:**
- テナントID未登録エラー
- AssumeRole失敗時のリトライ処理
- タイムアウトエラーのハンドリング

### 3. CDKスタック構成

#### コントロールプレーン（GenerativeAiUseCasesStack）更新要件

**追加リソース:**
- **DynamoDB Table**: Tenants
  - テーブル名: Tenants-{environment}
  - パーティションキー: tenantId (String)
  - 課金モード: PAY_PER_REQUEST
  - 暗号化: AWS_MANAGED
  - ポイントインタイムリカバリ: 有効
  - 削除ポリシー: RETAIN

- **KMS Key**: テナント情報暗号化用
  - エイリアス: TenantsKey-{environment}
  - 自動ローテーション: 有効
  - 削除ポリシー: RETAIN
  - 用途: クロスアカウントロールARNの暗号化

**Lambda環境変数追加:**
- TENANTS_TABLE_NAME: Tenantsテーブル名
- TENANTS_KMS_KEY_ID: KMSキーID

**IAM権限追加（Lambda実行ロール）:**
- **DynamoDB権限**: GetItem, PutItem, UpdateItem, Query
- **KMS権限**: Decrypt, Encrypt, GenerateDataKey
- **STS権限**: AssumeRoleWithWebIdentity
  - 制約条件: リージョン制限、テナントID検証

## プロビジョニング戦略

### 1. テナントアカウントのセットアップフロー

#### プロビジョニング手順

**フェーズ1: 信頼関係の設定**
1. **クロスアカウントIAMロール作成**
   - ロール名: TenantAccessRole-{tenantId}
   - 信頼関係: コントロールプレーンのIdentity Pool
   - 権限: テナント専用リソースへのフルアクセス
   - 制約: Principal Tagによるテナント制限

**フェーズ2: テナントリソースのデプロイ**
1. **CDK Cross-Account Deploy設定**
   - デプロイ先: テナント専用AWSアカウント
   - スタック: TenantS3Stack, TenantDynamoDBStack
   - パラメータ: tenantId, environment, region
   - 承認: 自動承認（RequireApproval.NEVER）

2. **既存Tenantスタックの利用**
   - TenantS3Stack: テナント専用S3バケット作成
   - TenantDynamoDBStack: テナント専用DynamoDBテーブル作成
   - 削除ポリシー: 本番環境では保持（RETAIN）

**フェーズ3: テナント情報の登録**
1. **メタデータ保存**
   - DynamoDB Tenantsテーブルに登録
   - KMS暗号化でクロスアカウントロールARNを保護
   - ステータス管理（provisioning → active）

#### プロビジョニングツール選択

**CDK Cross-Account Deploy（推奨）**
- 用途: 小〜中規模（10-50テナント）
- メリット: 柔軟性、デバッグの容易さ
- 設定: CDK App構成、env指定でクロスアカウント展開

**CloudFormation StackSets（大規模展開）**
- 用途: 大規模（50+テナント）
- メリット: 並列展開、一括管理
- 設定: StackSet作成、Account/Regionでのインスタンス管理

### 2. CloudFormation StackSetsの活用（大規模展開）

#### StackSets設定要件

**StackSet作成設定:**
- **StackSet名**: TenantResources-{ResourceType}
- **テンプレート**: 既存TenantスタックのCloudFormationテンプレート
- **Capabilities**: CAPABILITY_IAM（IAMリソース作成のため）
- **Parameters**:
  - TenantId: テナント識別子
  - Environment: 環境識別子（dev, staging, prod）
  - Region: デプロイ対象リージョン

**Operation Preferences:**
- **RegionConcurrencyType**: PARALLEL（並列実行）
- **MaxConcurrentPercentage**: 100（全並列）
- **FailureTolerancePercentage**: 5（5%まで失敗許容）

**デプロイメント管理:**
- **対象アカウント**: テナント専用AWSアカウントID
- **対象リージョン**: テナント指定リージョン
- **パラメータオーバーライド**: テナント固有値の設定

#### 管理ツール要件

**StackSet Manager機能:**
- createStackSet: 新規StackSet作成
- deployToTenantAccount: 特定テナントアカウントへのデプロイ
- updateStackInstances: 既存インスタンスの更新
- deleteStackInstances: インスタンス削除
- monitorOperations: デプロイメント状況監視

## セキュリティ考慮事項

### 1. アクセス制御

#### Principal Tagによる制限
**IAM Policy要件:**
- **アクセス条件**: Principal TagのTenantIDとResource TagのTenantIDが一致した場合のみアクセス許可
- **適用リソース**: テナント専用リソース（S3、DynamoDB等）
- **除外リソース**: 共用リソース（CloudWatch Logs、KMS等）
- **セキュリティメリット**: テナント間のデータ漏洩防止

#### Session Durationの制限
**セッション管理要件:**
- **最大セッション時間**: 3600秒（1時間）
- **セッション名**: テナントIDとタイムスタンプを含む一意名
- **ローテーション**: JWTトークンの有効期限に合わせて調整
- **キャッシュ禁止**: ユーザー分離と権限制御の為、認証情報のキャッシュ禁止

### 2. 監査とログ

#### CloudTrail設定
**各テナントアカウントの監査設定:**
- **スコープ**: マルチリージョン監査トレイル
- **グローバルサービスイベント**: 対象含む
- **ファイル検証**: 有効化（ログの改ざん防止）
- **データイベント**: S3オブジェクトアクセスを含む
- **保存先**: テナント専用監査ログS3バケット
- **アクセス制御**: コンプライアンスチームのみアクセス可能

#### VPC Flow Logs
**ネットワーク監視設定:**
- **対象**: テナント専用VPC（存在する場合）
- **トラフィックタイプ**: 全トラフィック（ACCEPT/REJECT両方）
- **出力先**: CloudWatch LogsまたはS3
- **ログ形式**: VPC Flow Logs標準形式
- **保存期間**: コンプライアンス要件に応じて設定
- **アラート**: 異常トラフィックパターンの監視

### 3. データ暗号化

#### S3暗号化
**テナント専用S3バケット暗号化要件:**
- **暗号化方式**: AWS KMS（Customer Managed Key推奨）
- **KMS Key**: テナント専用または共用キー
- **Bucket Key**: 有効化（コスト最適化）
- **SSL強制**: HTTPSアクセスのみ許可
- **アクセスログ**: サーバーアクセスログ有効化
- **バージョニング**: データ保護のため有効化

#### DynamoDB暗号化
**テナント専用DynamoDBテーブル暗号化要件:**
- **暗号化方式**: Customer Managed KMS Key
- **KMS Key**: S3と同KMS Keyを共用可能
- **ポイントインタイムリカバリ**: 有効化（データ復旧用）
- **削除保護**: 本番環境で有効化
- **バックアップ**: クロスリージョンバックアップ設定
- **アクセスパターン**: Principal Tagでテナント制限

## 段階的実装計画

### Phase 1: テナント管理基盤構築と非推奨コード削除（2-3週間）

#### 1.1 テナント管理基盤
- [ ] DynamoDB Tenantsテーブル作成（Phase 2対応フィールド含む）
- [ ] KMS Key作成・権限設定
- [ ] TenantManager実装（Phase 1機能）
- [ ] 単体テスト・統合テスト

#### 1.2 AssumeRoleWithWebIdentity実装（同一アカウント内）
- [ ] tenantCredentials.ts更新（同一アカウントロール対応）
- [ ] AssumeRoleWithWebIdentity実装
- [ ] テナント専用IAMロール作成（同一アカウント内）
- [ ] エラーハンドリング・リトライ機構

#### 1.3 非推奨コード削除とクリーンアップ
- [ ] ABACパターンコードの完全削除
- [ ] Identity Pool関連コードの削除
- [ ] Principal Tag制御ロジックの削除
- [ ] 不要なIAM Policy・ロールの削除

#### 1.4 Phase 1動作検証
- [ ] 同一アカウント内でのテナント分離テスト
- [ ] パフォーマンス・セキュリティ評価
- [ ] クリーンアーキテクチャの検証

### Phase 2: クロスアカウント機能追加（4-6週間）

#### 2.1 クロスアカウント基盤機能追加
- [ ] TenantsテーブルへのaccountId、encryptedCrossAccountRoleArn追加
- [ ] TenantManager拡張（クロスアカウント機能追加）
- [ ] KMS暗号化・復号化機能実装
- [ ] クロスアカウントアクセスフロー実装

#### 2.2 プロビジョニング機能
- [ ] TenantCrossAccountRoleStack実装
- [ ] 既存TenantS3Stack/TenantDynamoDBStackの更新
- [ ] CDK Cross-Account Deploy機能実装
- [ ] CloudFormation StackSets対応（オプション）

#### 2.3 プロビジョニングAPI
- [ ] テナントアカウント登録API
- [ ] リソースデプロイAPI
- [ ] プロビジョニング状態管理
- [ ] 管理画面UI（オプション）

#### 2.4 パイロットテスト
- [ ] 1-2テナントでのクロスアカウント機能テスト
- [ ] パフォーマンス・コスト評価
- [ ] 運用手順の検証・改善

#### 2.5 モニタリング・運用基盤
- [ ] CloudWatch メトリクス・アラート
- [ ] コスト監視ダッシュボード
- [ ] 障害通知・エスカレーション
- [ ] 運用ドキュメント整備

#### 2.6 本番展開
- [ ] 本番環境へのクロスアカウント機能デプロイ
- [ ] 全テナントのクロスアカウント対応
- [ ] セキュリティ監査
- [ ] 運用ドキュメント最終化

## 運用考慮事項

### 1. コスト管理

#### アカウント別コスト配分
**Cost Allocationタグ戦略:**
- **必須タグ**:
  - TenantID: テナント識別子
  - Environment: 環境識別子（dev/staging/prod）
  - CostCenter: コストセンター（SaaS-Platform）
- **タグ付与方法**: CDKスタックレベルで自動付与
- **コスト分析**: AWS Cost Explorerでテナント別コストを分析
- **レポート**: 月次テナント別コストレポート生成

#### リザーブドインスタンスの最適化
**コスト最適化戦略:**
- **Reserved Instances**: テナント横断での一括購入でスケールメリットを活用
- **Savings Plans**: Compute Savings Plansで柔軟なコスト削減
- **Spot Instances**: 非クリティカルなワークロードでの活用検討
- **ライトサイジング**: 定期的なリソース使用状況の見直し
- **アラート**: 異常なコスト増加の監視と通知

### 2. 災害復旧

#### クロスリージョンバックアップ
**S3クロスリージョンレプリケーション設定:**
- **レプリケーション対象**: テナントデータのみ
- **バックアップ先**: 異なるリージョンのテナントアカウント内
- **レプリケーションステータス**: 有効化
- **暗号化**: バックアップ先でもKMS暗号化維持
- **ライフサイクル管理**: 古いバックアップの自動削除
- **アクセス制限**: バックアップへのアクセスは制限されたロールのみ

#### DynamoDBポイントインタイムリカバリ
**DynamoDBバックアップ戦略:**
- **Point-in-Time Recovery**: 有効化（過升35日間のリカバリ）
- **Deletion Protection**: 本番環境で有効化
- **グローバルテーブル**: 災害復旧用のクロスリージョンレプリケーション
- **バックアップタスク**: 定期的なフルバックアップとS3へのエクスポート
- **リストア手順**: テスト済みのリストア手順書の整備

### 3. スケーラビリティ

#### API Gateway制限
**スケーラビリティ設定:**
- **スロットリング**: テナントサイズに応じたレート制限
- **Usage Plan**: テナント別のAPI使用量制限
- **キャッシュ戦略**: テナントデータの分離を保ったキャッシュ
- **ロードバランシング**: テナント間の負荷分散
- **監視**: CloudWatchでテナント別メトリクス監視

#### Lambda同時実行数管理
**Lambdaスケーラビリティ設定:**
- **予約同時実行数**: テナントサイズに応じて設定
- **タイムアウト**: 適切なタイムアウト値設定
- **メモリ配分**: ワークロードに応じた最適化
- **環境変数**: テナント情報の加工用設定
- **デッドレターキュー**: エラーハンドリングと再試行機構
- **監視**: エラーレート、レスポンス時間、同時実行数の監視

## コスト見積もり

### 従来のABACパターン（月額）
- DynamoDB: $50-100（テナント数により変動）
- S3: $30-60（テナント数により変動）
- Lambda: $20-40
- CloudWatch: $10-20
- **合計: $110-220/月**

### アカウント分離パターン（月額、テナント10社想定）
- DynamoDB (管理用): $10
- KMS: $1/key × 1 = $1
- S3 (テナント別): $30 × 10 = $300
- Lambda: $20 × 10 = $200
- CloudWatch: $10 × 10 = $100
- クロスアカウントAPI呼び出し: $5
- **合計: $616/月**

### ROI分析
- **初期投資**: 開発工数4-6人月
- **運用コスト増**: 約2.5-3倍
- **セキュリティ向上**: 定量化困難だが、コンプライアンス要件対応により新規顧客獲得機会
- **運用効率化**: テナント別の独立運用により障害影響範囲限定

## まとめ

段階的実装アプローチにより以下の効果が期待できます：

### Phase 1の成果
1. **クリーンアーキテクチャ**: 非推奨コードを完全削除した簡潔な設計
2. **検証可能性**: 新しい認証フローを安全に検証・調整
3. **技術的負債ゼロ**: ABACパターン等の非推奨実装の完全除去
4. **実装基盤**: クロスアカウント対応に向けたクリーンな基盤構築

### Phase 2の成果
1. **セキュリティ強化**: 物理的なアカウント分離によるデータ保護
2. **コンプライアンス対応**: 規制要件への完全対応
3. **運用の安定性**: テナント間での障害影響の完全分離
4. **監査の簡素化**: アカウント別の明確な責任範囲

### 段階的実装の利点
1. **PR管理**: 適切なサイズのPRで段階的な実装とレビュー
2. **技術リスク軽減**: 段階的な技術検証による実装リスクの最小化
3. **クリーンコード**: 各フェーズで非推奨コードを削除し技術的負債ゼロ
4. **実装効率**: 新規実装により移行コストとリスクを排除

### コスト影響
- **Phase 1**: 追加コスト最小（主にDynamoDB、KMS）
- **Phase 2**: 運用コストの2.5-3倍増（テナント別アカウント）

### 推奨事項
- **Phase 1完了後の評価**: Phase 2実装判断のための効果測定
- **段階的実装**: リスクを最小化するためのフェーズド展開
- **コスト監視**: 継続的なコスト最適化の実施
- **自動化**: プロビジョニング・運用の徹底的な自動化
- **セキュリティ**: 定期的なセキュリティ監査・ペネトレーションテスト
