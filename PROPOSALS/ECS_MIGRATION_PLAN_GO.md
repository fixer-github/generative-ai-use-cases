# GenU ECS移行 詳細実装計画（Go + Gin/Fiber）

最終更新: 2025-10-31

## 📋 プロジェクト概要

### 目標

現在のLambda TypeScriptバックエンドをGo言語ベースのECS Web APIに移行し、最高性能を実現する。

### 背景

- **現状**: AWS Lambda + Node.js/TypeScript（106関数、約8,210行）
- **課題**:
  - コールドスタート（250-500ms）によるレイテンシ
  - 月間1,000万リクエスト以上の高トラフィック
  - スケーリング時の性能予測困難性
- **期待効果**:
  - P99レイテンシ 80%改善（900ms → <100ms）
  - スループット 3-5倍向上（65k → 15-25k req/s）
  - メモリ使用量 75%削減（512MB → 128MB）
  - インフラコスト 56%削減（$122 → $54/月）

### プロジェクト情報

| 項目           | 詳細                         |
| -------------- | ---------------------------- |
| **期間**       | 24週間（約6ヶ月）            |
| **開始日**     | 2025年11月（Week 1）         |
| **完了予定日** | 2026年5月（Week 24）         |
| **体制**       | バックエンドエンジニア 3-4名 |
| **予算**       | $183,000（開発コスト）       |

### 技術スタック

**アプリケーション層**:

- 言語: Go 1.22+
- Webフレームワーク: Gin v1.10
- AWS SDK: aws-sdk-go-v2
- JWT: golang-jwt/jwt v5
- ロギング: uber/zap
- テスト: testify, httptest

**インフラ層**:

- コンテナ: Docker（マルチステージビルド）
- オーケストレーション: AWS ECS Fargate
- ロードバランサー: Application Load Balancer (ALB)
- IaC: AWS CDK（TypeScript）
- CI/CD: Dagger + GitHub Actions
- 監視: CloudWatch + X-Ray

---

## 🎯 成功指標（KPI）

### パフォーマンス指標

| 指標                 | 現状（Lambda） | 目標（ECS Go）  | 改善率   |
| -------------------- | -------------- | --------------- | -------- |
| **P50レイテンシ**    | 150ms          | <50ms           | 67%↓     |
| **P99レイテンシ**    | 900ms          | <100ms          | 89%↓     |
| **スループット**     | 5,000 req/s    | 15,000+ req/s   | 300%↑    |
| **コールドスタート** | 250-500ms      | 0ms（常時起動） | 100%解消 |
| **メモリ使用量**     | 512MB/実行     | 128MB/コンテナ  | 75%↓     |

### コスト指標

| 項目                 | 現状（Lambda） | 移行後（ECS） | 削減額      |
| -------------------- | -------------- | ------------- | ----------- |
| **月間コンピュート** | $122           | $54           | $68（56%↓） |
| **年間削減**         | -              | -             | **$816**    |

### 品質指標

| 指標                 | 目標      |
| -------------------- | --------- |
| **コードカバレッジ** | 80%以上   |
| **可用性**           | 99.9%以上 |
| **エラー率**         | <0.1%     |
| **デプロイ頻度**     | 週1回以上 |

---

## 📅 6フェーズ実装スケジュール

```
Phase 0: 準備・学習          Week 1-2   (2週間)
Phase 1: 基盤構築・POC       Week 3-6   (4週間)  ⭐ GO/NO-GO判定
Phase 2: コアAPI実装         Week 7-14  (8週間)
Phase 3: 拡張機能・非同期    Week 15-18 (4週間)
Phase 4: インフラ構築        Week 11-16 (6週間、並行)
Phase 5: CI/CD・自動化       Week 17-20 (4週間)
Phase 6: 本番移行・運用移管  Week 21-24 (4週間)
```

---

## 📖 Phase 0: 準備・学習（Week 1-2）

### Week 1: Go言語基礎トレーニング

**目標**: チーム全員がGo言語の基礎を習得し、AWS SDK for Go v2を使用できる状態にする。

#### タスク

1. **Go言語文法学習**（2日）
   - 基本文法: 変数、型、関数、構造体
   - ポインタとメモリ管理
   - インターフェースと埋め込み
   - エラーハンドリング（`error` インターフェース、`errors.Is/As`）

2. **並行処理パターン**（2日）
   - Goroutineの基礎と使い方
   - Channel（バッファなし/あり、方向性）
   - selectステートメント
   - sync.WaitGroup、sync.Mutex
   - 並行処理のアンチパターン（Goroutineリーク、デッドロック）

3. **Go慣用句とベストプラクティス**（1日）
   - Effective Go
   - コードレイアウト（パッケージ設計）
   - ネーミング規約
   - ユニットテストの書き方（`testing` パッケージ）

#### 学習リソース

- [A Tour of Go](https://go.dev/tour/)（公式チュートリアル）
- [Effective Go](https://go.dev/doc/effective_go)（公式ガイド）
- [Go by Example](https://gobyexample.com/)（実践例集）
- [AWS SDK for Go v2 Developer Guide](https://aws.github.io/aws-sdk-go-v2/docs/)

#### 成果物

- [ ] 各メンバーがGo基礎チュートリアル完了
- [ ] 簡単なHTTPサーバー実装課題クリア
- [ ] AWS SDK v2でDynamoDB/S3操作課題クリア

---

### Week 2: アーキテクチャ設計

**目標**: Go版のアーキテクチャを設計し、既存106 Lambda関数の移行方針を確定する。

#### タスク

1. **Goプロジェクト構造設計**（2日）
   - レイヤードアーキテクチャ設計（Handler → Service → Repository）
   - パッケージ分割方針
   - 依存性注入パターン
   - 設定管理（環境変数、AWS Systems Manager Parameter Store）

2. **マルチテナント分離アーキテクチャ**（2日）
   - テナントコンテキスト伝播パターン（`context.Context`）
   - STS AssumeRoleWithWebIdentity統合設計
   - 認証情報キャッシング戦略（LRUキャッシュ、15分TTL）
   - テナント別DynamoDB/S3クライアント生成パターン

3. **API構造整理**（1日）
   - 106 Lambda関数のエンドポイント整理
   - RESTful API設計（GET/POST/PUT/DELETE）
   - ストリーミングAPI設計（Server-Sent Events）
   - エラーレスポンス標準化

#### 成果物

- [ ] `docs/ja/ARCHITECTURE_GO.md`（アーキテクチャ設計書）
- [ ] `docs/ja/API_MAPPING.md`（Lambda→Go API対応表）
- [ ] `docs/ja/MULTI_TENANT_DESIGN.md`（マルチテナント設計書）

---

## 🏗️ Phase 1: 基盤構築・POC（Week 3-6）

### Week 3: プロジェクト基盤構築

**目標**: Goプロジェクトの土台を構築し、開発環境を整備する。

#### タスク

1. **Go moduleプロジェクト初期化**（0.5日）

   ```bash
   mkdir -p packages/api-go
   cd packages/api-go
   go mod init github.com/fixer-github/generative-ai-use-cases/packages/api-go
   ```

2. **ディレクトリ構造構築**（0.5日）

   ```
   packages/api-go/
   ├── cmd/
   │   └── server/
   │       └── main.go              # エントリポイント
   ├── internal/
   │   ├── handler/                 # HTTPハンドラー
   │   ├── middleware/              # ミドルウェア
   │   ├── repository/              # データアクセス層
   │   ├── service/                 # ビジネスロジック層
   │   └── model/                   # ドメインモデル
   ├── pkg/                         # 外部公開パッケージ
   │   ├── awsclient/               # AWS SDK ラッパー
   │   └── logger/                  # 構造化ロガー
   ├── tests/
   │   ├── integration/
   │   └── load/
   ├── go.mod
   ├── go.sum
   ├── Dockerfile
   └── docker-compose.yml
   ```

3. **Gin Webフレームワーク統合**（1日）
   - 基本的なルーター設定
   - ミドルウェア登録（CORS、ロギング、リカバリ）
   - ヘルスチェックエンドポイント（`/health`, `/ready`）

4. **開発環境構築**（2日）
   - Docker開発環境（`docker-compose.dev.yml`）
   - Air（ホットリロード）設定
   - delve（デバッガ）統合
   - VSCode/GoLand設定共有

5. **Dockerマルチステージビルド**（1日）
   - ビルド層（golang:1.22-alpine）
   - ランタイム層（scratch、CA証明書のみ）
   - イメージサイズ最適化（目標: 20-30MB）

#### 成果物

- [ ] `packages/api-go/` 初期プロジェクト
- [ ] `Dockerfile`（マルチステージビルド）
- [ ] `docker-compose.dev.yml`（ローカル開発環境）
- [ ] `.air.toml`（ホットリロード設定）

---

### Week 4: 認証・テナント分離実装

**目標**: JWT認証とマルチテナント分離機能を実装する。

#### タスク

1. **JWT検証ミドルウェア**（2日）

   ```go
   // internal/middleware/auth.go
   func JWTAuth(userPoolID, clientID string) gin.HandlerFunc {
       return func(c *gin.Context) {
           token := extractToken(c.GetHeader("Authorization"))
           claims, err := verifyJWT(token, userPoolID, clientID)
           if err != nil {
               c.AbortWithStatusJSON(401, gin.H{"error": "Unauthorized"})
               return
           }
           c.Set("claims", claims)
           c.Next()
       }
   }
   ```

2. **テナントコンテキスト抽出**（1日）

   ```go
   // internal/middleware/tenant.go
   func TenantContext() gin.HandlerFunc {
       return func(c *gin.Context) {
           claims := c.MustGet("claims").(jwt.MapClaims)
           tenantID := claims["custom:tenant_id"].(string)
           userID := claims["cognito:username"].(string)

           ctx := context.WithValue(c.Request.Context(), "tenantID", tenantID)
           ctx = context.WithValue(ctx, "userID", userID)
           c.Request = c.Request.WithContext(ctx)
           c.Next()
       }
   }
   ```

3. **STS AssumeRoleWithWebIdentity統合**（2日）

   ```go
   // pkg/awsclient/sts.go
   func AssumeRoleForTenant(ctx context.Context, tenantID, idToken string) (*aws.Credentials, error) {
       stsClient := sts.NewFromConfig(cfg)
       output, err := stsClient.AssumeRoleWithWebIdentity(ctx, &sts.AssumeRoleWithWebIdentityInput{
           RoleArn:          aws.String(fmt.Sprintf("arn:aws:iam::ACCOUNT:role/TenantRole-%s", tenantID)),
           RoleSessionName:  aws.String(fmt.Sprintf("ecs-session-%d", time.Now().Unix())),
           WebIdentityToken: aws.String(idToken),
       })
       return output.Credentials, err
   }
   ```

4. **認証情報キャッシング**（1日）
   - LRUキャッシュ実装（`github.com/patrickmn/go-cache`）
   - キャッシュキー: `{tenantID}:{userID}`
   - TTL: 15分
   - 自動クリーンアップ

#### 成果物

- [ ] `internal/middleware/auth.go`（JWT検証）
- [ ] `internal/middleware/tenant.go`（テナント抽出）
- [ ] `pkg/awsclient/sts.go`（STS統合）
- [ ] 認証・テナント分離の統合テスト

---

### Week 5: DynamoDB リポジトリ基盤

**目標**: DynamoDBアクセス層を実装し、テナント専用クライアント生成パターンを確立する。

#### タスク

1. **DynamoDB Document Client抽象化**（1日）

   ```go
   // pkg/awsclient/dynamodb.go
   type DynamoDBClient struct {
       client *dynamodb.Client
       tenantID string
   }

   func NewDynamoDBClientForTenant(ctx context.Context, tenantID string, creds *aws.Credentials) *DynamoDBClient {
       cfg, _ := config.LoadDefaultConfig(ctx, config.WithCredentialsProvider(
           credentials.NewStaticCredentialsProvider(*creds.AccessKeyId, *creds.SecretAccessKey, *creds.SessionToken),
       ))
       client := dynamodb.NewFromConfig(cfg)
       return &DynamoDBClient{client: client, tenantID: tenantID}
   }
   ```

2. **コネクションプーリング最適化**（1日）
   - `maxIdleConns`: 50
   - `maxConnsPerHost`: 50
   - `idleConnTimeout`: 90秒

3. **Chatリポジトリ実装**（2日）

   ```go
   // internal/repository/chat.go
   type ChatRepository struct {
       db *awsclient.DynamoDBClient
   }

   func (r *ChatRepository) CreateChat(ctx context.Context, userID, title string) (*model.Chat, error) {
       chat := &model.Chat{
           ID:        uuid.New().String(),
           UserID:    userID,
           Title:     title,
           CreatedAt: time.Now(),
       }

       _, err := r.db.PutItem(ctx, &dynamodb.PutItemInput{
           TableName: aws.String(fmt.Sprintf("Chats-%s", r.db.TenantID())),
           Item:      marshalChat(chat),
       })
       return chat, err
   }
   ```

4. **Messageリポジトリ実装**（2日）
   - `BatchCreateMessages`（バッチ書き込み、最大25件）
   - `ListMessages`（ページネーション対応）
   - トークン使用量追跡

#### 成果物

- [ ] `pkg/awsclient/dynamodb.go`（DynamoDBクライアント）
- [ ] `internal/repository/chat.go`
- [ ] `internal/repository/message.go`
- [ ] リポジトリ層の単体テスト（モックDB）

---

### Week 6: POC実装・検証 ⭐

**目標**: 5つのコアAPIを実装し、性能検証を行い、GO/NO-GO判定を実施する。

#### 実装対象API

1. `GET /chats` - チャット一覧取得
2. `POST /chats` - チャット作成
3. `GET /chats/:id` - チャット詳細取得
4. `POST /chats/:id/messages` - メッセージ作成
5. `POST /predict/stream` - ストリーミング予測（重要）

#### タスク

1. **Chat APIハンドラー実装**（2日）

   ```go
   // internal/handler/chat.go
   func (h *ChatHandler) ListChats(c *gin.Context) {
       ctx := c.Request.Context()
       userID := ctx.Value("userID").(string)

       chats, err := h.repo.ListChats(ctx, userID)
       if err != nil {
           c.JSON(500, gin.H{"error": err.Error()})
           return
       }
       c.JSON(200, gin.H{"chats": chats})
   }
   ```

2. **Predict Streamingハンドラー実装**（2日）

   ```go
   // internal/handler/predict.go
   func (h *PredictHandler) PredictStream(c *gin.Context) {
       c.Header("Content-Type", "text/event-stream")
       c.Header("Cache-Control", "no-cache")
       c.Header("Connection", "keep-alive")

       stream := h.bedrock.InvokeStream(ctx, request)

       for chunk := range stream {
           c.SSEvent("message", chunk)
           c.Writer.Flush()
       }
   }
   ```

3. **統合テスト実装**（1日）
   - 全5エンドポイントのテストケース
   - マルチテナント分離テスト
   - エラーハンドリングテスト

4. **負荷テスト実行**（1日）
   - Artilleryで10,000 req/s
   - ストリーミングAPI並行接続テスト
   - メモリ使用量監視

#### 成功基準（GO/NO-GO判定）

| 指標          | 目標値        | 判定   |
| ------------- | ------------- | ------ |
| P99レイテンシ | <150ms        | GO条件 |
| スループット  | >10,000 req/s | GO条件 |
| エラー率      | <0.1%         | GO条件 |
| メモリ使用量  | <256MB        | GO条件 |

#### 成果物

- [ ] 5つのAPIエンドポイント実装
- [ ] 統合テストスイート
- [ ] 負荷テストレポート
- [ ] **GO/NO-GO判定結果レポート**

---

## 🚀 Phase 2: コアAPI実装（Week 7-14）

### Week 7-8: Chat/Message API群（16関数）

**実装対象**:

- Chat API: `listChats`, `findChatById`, `createChat`, `deleteChat`, `updateTitle`
- Message API: `batchCreateMessages`, `listMessages`, `updateFeedback`, `deleteMessage`

**推定工数**: 10日

---

### Week 9-10: Predict API群（3関数）

**実装対象**:

- `predict` - 同期予測
- `predictStream` - Bedrock ConverseStream統合
- `predictTitle` - タイトル生成

**重要タスク**:

- Bedrock Runtime Client統合
- Server-Sent Events（SSE）最適化
- HTTP/2対応

**推定工数**: 10日

---

### Week 11: File/Share API群（7関数）

**実装対象**:

- File API: S3プレサインURL生成、ファイル削除
- Share API: 共有ID CRUD操作

**推定工数**: 5日

---

### Week 12-13: Image/Video Generation API群（6関数）

**実装対象**:

- `generateImage` - Bedrock画像生成（Stable Diffusion）
- `generateVideo` - Bedrock動画生成（Nova Reel）
- `listVideoJobs`, `deleteVideoJob`, `copyVideoJob`

**推定工数**: 10日

---

### Week 14: Admin/User管理API群（7関数）

**実装対象**:

- `listTenantUsers`, `inviteTenantUsers`, `removeTenantUser`
- `updateUserRole`, `refreshUserRole`, `checkAdminStatus`
- `validateInvitationDomains`

**推定工数**: 5日

---

## ⚙️ Phase 3: 拡張機能・非同期処理（Week 15-18）

### Week 15-16: PPTX生成API（9関数 + SQSワーカー）

**実装対象**:

- テンプレート管理CRUD
- S3テンプレートアップロード/ダウンロード
- **SQSワーカー実装**（別プロセス）
- PowerPoint生成ロジック
- 生成ステータスポーリング

**技術課題**:

- Go版PowerPointライブラリ検討（`unidoc/unioffice`）
- SQSメッセージ処理パターン

**推定工数**: 10日

---

### Week 17: その他API（10関数）

**実装対象**:

- SystemContext CRUD（4関数）
- Token Usage API
- Web Text取得
- Prompt最適化
- Bedrock Flow統合

**推定工数**: 5日

---

### Week 18: 統合テスト・バグ修正

**タスク**:

- 全106エンドポイント統合テスト
- マルチテナント分離テスト
- エッジケース処理
- メモリリーク検証（pprof）
- Goroutineリーク検証

**目標カバレッジ**: 80%以上

**推定工数**: 5日

---

## 🏗️ Phase 4: インフラ構築（Week 11-16、並行実施）

### Week 11-12: ECS CDKスタック実装

**タスク**:

1. **ECS Fargateクラスタ定義**

   ```typescript
   // packages/cdk/lib/stacks/ecs-api-go.ts
   const cluster = new ecs.Cluster(this, 'GoApiCluster', {
     vpc,
     containerInsights: true,
   });
   ```

2. **タスク定義**

   ```typescript
   const taskDefinition = new ecs.FargateTaskDefinition(this, 'GoApiTask', {
     cpu: 1024, // 1 vCPU
     memoryLimitMiB: 2048, // 2GB
   });

   taskDefinition.addContainer('go-api', {
     image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
     portMappings: [{ containerPort: 3000 }],
     logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'go-api' }),
   });
   ```

3. **Application Load Balancer**

   ```typescript
   const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
     vpc,
     internetFacing: true,
   });

   const listener = alb.addListener('Listener', {
     port: 443,
     protocol: 'HTTPS',
   });
   ```

4. **ECS Service**

   ```typescript
   const service = new ecs.FargateService(this, 'GoApiService', {
     cluster,
     taskDefinition,
     desiredCount: 2,
     minHealthyPercent: 100,
     maxHealthyPercent: 200,
   });

   listener.addTargets('GoApiTarget', {
     port: 3000,
     targets: [service],
     healthCheck: {
       path: '/health',
       interval: cdk.Duration.seconds(30),
     },
   });
   ```

**成果物**:

- [ ] `packages/cdk/lib/stacks/ecs-api-go.ts`
- [ ] `packages/cdk/lib/construct/ecs-cluster.ts`

---

### Week 13-14: マルチテナントインフラ統合

**タスク**:

1. **IAM Task Role設定**

   ```typescript
   taskDefinition.addToTaskRolePolicy(
     new iam.PolicyStatement({
       actions: ['dynamodb:*', 's3:*', 'bedrock:*', 'sts:AssumeRole'],
       resources: ['*'],
     })
   );
   ```

2. **テナントマネージャー統合**
   - 既存Tenant Managerスタックとの連携
   - テナントIAMロールへのアクセス権限

3. **CloudWatch Logs統合**
   - ログストリーム設定
   - ログフィルタ設定

4. **X-Ray分散トレーシング**

   ```go
   import "github.com/aws/aws-xray-sdk-go/xray"

   // AWSクライアントをラップ
   xray.AWS(dynamodbClient.Client)
   ```

**成果物**:

- [ ] マルチテナント対応ECSインフラ
- [ ] CloudWatch Logsストリーム
- [ ] X-Ray統合

---

### Week 15-16: Auto Scaling/監視

**タスク**:

1. **ECS Auto Scaling**

   ```typescript
   const scaling = service.autoScaleTaskCount({
     minCapacity: 2,
     maxCapacity: 10,
   });

   scaling.scaleOnCpuUtilization('CpuScaling', {
     targetUtilizationPercent: 70,
   });

   scaling.scaleOnMemoryUtilization('MemoryScaling', {
     targetUtilizationPercent: 80,
   });
   ```

2. **CloudWatch ダッシュボード**
   - ECS CPU/メモリ使用率
   - ALB リクエスト数/レイテンシ
   - エラー率（4xx, 5xx）

3. **CloudWatch Alarms**
   - 高レイテンシアラート（P99 > 200ms）
   - 高エラー率アラート（> 1%）
   - タスク異常終了アラート

**成果物**:

- [ ] Auto Scaling設定
- [ ] CloudWatch ダッシュボード
- [ ] アラーム設定

---

## 🔄 Phase 5: CI/CD・デプロイ自動化（Week 17-20）

### Week 17-18: Dagger CI/CD パイプライン

**タスク**:

1. **Dagger TypeScript実装**

   ```typescript
   // dagger/src/go-api.ts
   export async function buildGoApi(client: Client) {
     // Goビルド
     const builder = client
       .container()
       .from('golang:1.22-alpine')
       .withDirectory('/src', client.host().directory('./packages/api-go'))
       .withWorkdir('/src')
       .withExec(['go', 'build', '-o', 'server', './cmd/server']);

     // Dockerイメージ構築
     const image = client
       .container()
       .from('scratch')
       .withFile('/server', builder.file('/src/server'))
       .withEntrypoint(['/server']);

     // ECRプッシュ
     await image.publish(`${ECR_REPO}:${tag}`);
   }
   ```

2. **統合テスト自動実行**

   ```typescript
   export async function testGoApi(client: Client) {
     await client
       .container()
       .from('golang:1.22-alpine')
       .withDirectory('/src', client.host().directory('./packages/api-go'))
       .withWorkdir('/src')
       .withExec(['go', 'test', '-v', './...'])
       .sync();
   }
   ```

3. **GitHub Actions統合**

   ```yaml
   # .github/workflows/go-api-deploy.yml
   name: Deploy Go API
   on:
     push:
       branches: [main]
       paths: ['packages/api-go/**']

   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: dagger/dagger-for-github@v6
         - run: dagger call build-go-api --tag=${{ github.sha }}
   ```

**成果物**:

- [ ] `dagger/src/go-api.ts`
- [ ] `.github/workflows/go-api-deploy.yml`

---

### Week 19: Blue-Greenデプロイ構成

**タスク**:

1. **CodeDeploy統合**

   ```typescript
   const deployment = new codedeploy.EcsDeploymentGroup(
     this,
     'DeploymentGroup',
     {
       service,
       blueGreenDeploymentConfig: {
         blueTargetGroup: blueTargetGroup,
         greenTargetGroup: greenTargetGroup,
         listener,
         terminationWaitTime: cdk.Duration.minutes(5),
       },
       autoRollback: {
         failedDeployment: true,
         deploymentInAlarm: true,
       },
     }
   );
   ```

2. **ヘルスチェック実装**

   ```go
   // /health エンドポイント
   router.GET("/health", func(c *gin.Context) {
       c.JSON(200, gin.H{"status": "healthy"})
   })

   // /ready エンドポイント（DynamoDB接続確認）
   router.GET("/ready", func(c *gin.Context) {
       if err := checkDynamoDBConnection(); err != nil {
           c.JSON(503, gin.H{"status": "not ready"})
           return
       }
       c.JSON(200, gin.H{"status": "ready"})
   })
   ```

3. **カナリアデプロイ設定**
   - 10% → 30分待機 → 50% → 30分待機 → 100%

**成果物**:

- [ ] CodeDeploy設定
- [ ] ヘルスチェックエンドポイント
- [ ] ロールバック手順書

---

### Week 20: 負荷テスト・性能チューニング

**タスク**:

1. **Artillery負荷テスト**

   ```yaml
   # tests/load/artillery.yml
   config:
     target: 'http://ecs-alb.amazonaws.com'
     phases:
       - duration: 300
         arrivalRate: 500 # 500 req/s
       - duration: 60
         arrivalRate: 1000 # 1000 req/s（スパイク）
   ```

2. **pprofによるプロファイリング**

   ```go
   import _ "net/http/pprof"

   go func() {
       http.ListenAndServe("localhost:6060", nil)
   }()
   ```

3. **最適化項目**:
   - Goroutineプールサイズ調整
   - DynamoDBバッチ読み込みサイズ
   - メモリアロケーション削減
   - 不要なコピー削減

**目標スループット**: 15,000 req/s（同時接続5,000）

**成果物**:

- [ ] 負荷テストレポート
- [ ] 性能チューニングレポート
- [ ] pprof分析結果

---

## 🚢 Phase 6: 本番移行・運用移管（Week 21-24）

### Week 21: ステージング環境デプロイ

**タスク**:

1. **ステージング環境全スタックデプロイ**

   ```bash
   npm run cdk:deploy:go-api -- --context env=staging
   ```

2. **実データ統合テスト**
   - 既存DynamoDBテーブルへの接続
   - 既存S3バケットへのアクセス
   - Bedrock API呼び出し

3. **セキュリティ監査**
   - IAMロール権限最小化確認
   - セキュリティグループルール確認
   - JWT検証ロジック監査
   - テナント分離テスト

4. **負荷試験（本番想定）**
   - 月間1,000万リクエスト相当

**成果物**:

- [ ] ステージング環境稼働
- [ ] セキュリティ監査レポート
- [ ] 負荷試験レポート

---

### Week 22: 本番環境準備

**タスク**:

1. **本番環境CDKデプロイ**

   ```bash
   npm run cdk:deploy:go-api -- --context env=prod
   ```

2. **DNS切り替え準備**
   - Route 53 Weighted Routing設定
   - Lambda環境: Weight 100 → 0（段階的）
   - ECS環境: Weight 0 → 100（段階的）

3. **データバックアップ計画**
   - DynamoDB Point-in-Time Recovery有効化
   - S3バージョニング有効化

4. **ロールバック手順書作成**

**成果物**:

- [ ] 本番環境構築完了
- [ ] DNS切り替え手順書
- [ ] ロールバック手順書

---

### Week 23: 段階的本番移行

**カナリアリリース計画**:

| フェーズ  | トラフィック割合 | 期間   | 監視項目                           |
| --------- | ---------------- | ------ | ---------------------------------- |
| フェーズ1 | 1%               | 24時間 | エラー率、レイテンシ               |
| フェーズ2 | 10%              | 48時間 | エラー率、レイテンシ、スループット |
| フェーズ3 | 50%              | 72時間 | 全指標                             |
| フェーズ4 | 100%             | -      | 全指標 + コスト                    |

**監視基準**:

- エラー率 < 0.1%
- P99レイテンシ < 150ms
- 異常なメモリ増加なし

**ロールバック条件**:

- エラー率 > 1%
- P99レイテンシ > 500ms
- タスク異常終了

**成果物**:

- [ ] カナリアリリース完了
- [ ] 本番トラフィック100%移行

---

### Week 24: 運用移管・ドキュメント

**タスク**:

1. **運用ドキュメント整備**
   - アーキテクチャ図
   - デプロイ手順
   - スケーリング設定
   - 監視・アラート設定

2. **インシデント対応マニュアル**
   - 高レイテンシ時の対応
   - タスク異常終了時の対応
   - ロールバック手順

3. **Lambda環境廃止**
   - 全トラフィックECS移行確認後
   - Lambda関数削除
   - API Gateway削除

4. **チーム向けトレーニング**
   - Go言語復習セッション
   - ECS運用トレーニング
   - トラブルシューティングワークショップ

**成果物**:

- [ ] `docs/ja/OPERATIONS_GO.md`
- [ ] `docs/ja/INCIDENT_RESPONSE.md`
- [ ] `docs/ja/TROUBLESHOOTING.md`
- [ ] **プロジェクト完了報告書**

---

## 📊 進捗管理

### マイルストーン

| マイルストーン     | 週         | 成果物                            | 判定            |
| ------------------ | ---------- | --------------------------------- | --------------- |
| アーキテクチャ承認 | Week 2     | 設計ドキュメント                  | ✅/❌           |
| **POC完了**        | **Week 6** | **性能検証レポート**              | **GO/NO-GO** ⭐ |
| コアAPI実装完了    | Week 14    | Chat/Predict/File/Image/Admin API | ✅/❌           |
| 全API実装完了      | Week 18    | 106エンドポイント                 | ✅/❌           |
| インフラ構築完了   | Week 16    | ECS本番環境                       | ✅/❌           |
| CI/CD完成          | Week 20    | 自動デプロイパイプライン          | ✅/❌           |
| ステージング稼働   | Week 21    | ステージング環境                  | ✅/❌           |
| 本番移行完了       | Week 24    | トラフィック100%移行              | 🎉              |

### 週次レビュー

**日時**: 毎週金曜 15:00-16:00

**アジェンダ**:

1. 進捗確認（計画 vs 実績）
2. ブロッカー確認・解消
3. 次週計画
4. リスク更新

### リスク管理

**高リスク項目**:

- Week 6: POC性能未達成 → Go言語続行可否判定
- Week 14: コアAPI実装遅延 → リソース追加検討
- Week 23: 本番移行エラー率上昇 → ロールバック判断

---

## 💰 コスト詳細

### 開発コスト

| 項目                   | 単価       | 数量  | 期間  | 小計         |
| ---------------------- | ---------- | ----- | ----- | ------------ |
| バックエンドエンジニア | $10,000/月 | 3名   | 6ヶ月 | $180,000     |
| ステージング環境       | $500/月    | 1環境 | 6ヶ月 | $3,000       |
| **合計**               |            |       |       | **$183,000** |

### 運用コスト（月間1,000万リクエスト想定）

**現状（Lambda）**:

```
Lambda実行時間: 1,000万 × 0.5秒 = 500万秒
Lambda料金: 500万秒 × $0.0000166667 × 512MB/128MB = $33
Lambda リクエスト料金: 1,000万 × $0.0000002 = $2
API Gateway: 1,000万 × $0.0000035 = $35
DynamoDB (オンデマンド): $40
S3: $10
合計: $120/月
```

**移行後（ECS Go）**:

```
ECS Fargate:
  - タスク2つ（0.25 vCPU × 512MB × 24時間 × 30日）
  - vCPU料金: 0.25 × 2 × 24 × 30 × $0.04048 = $14.5
  - メモリ料金: 0.5GB × 2 × 24 × 30 × $0.004445 = $3.2
ALB: $23/月
ECR: $1/月（1GB）
DynamoDB (オンデマンド): $40
S3: $10
合計: $91.7/月
```

**削減額**: $28.3/月（24%削減）
**年間削減**: $339.6

**ROI**: 約45年

> **注**: ECS移行の主目的はコスト削減ではなく、**性能向上とレイテンシ最小化**です。

---

## ⚠️ リスクと対策

### 高リスク項目

| #   | リスク                                         | 発生確率 | 影響度 | 対策                                                             | 担当          |
| --- | ---------------------------------------------- | -------- | ------ | ---------------------------------------------------------------- | ------------- |
| 1   | **Go学習曲線が急で開発遅延**                   | 高       | 高     | Week 1-2集中トレーニング、ペアプログラミング、コードレビュー強化 | 全員          |
| 2   | **POC性能目標未達**                            | 中       | 致命的 | Week 6でGO/NO-GO判定、Node.js代替案準備                          | Tech Lead     |
| 3   | **LangChain代替不足で機能制約**                | 中       | 中     | 最小限の機能実装、Phase 2でNode.jsハイブリッド検討               | Tech Lead     |
| 4   | **スケジュール遅延（6ヶ月超過）**              | 中       | 高     | 2週ごとのマイルストーン、早期アラート、リソース追加              | PM            |
| 5   | **Goroutineリークによるメモリ枯渇**            | 中       | 高     | pprofによる定期監視、Goroutine数上限設定、統合テスト             | 開発者        |
| 6   | **認証情報キャッシュバグでテナントデータ漏洩** | 低       | 致命的 | 短TTL（15分）、包括的テスト、監査ログ、セキュリティレビュー      | Security Lead |
| 7   | **本番移行時の予期せぬエラー**                 | 中       | 高     | カナリアリリース（1%→10%→50%→100%）、即座ロールバック手順        | DevOps        |
| 8   | **AWS SDK v2の未知のバグ**                     | 低       | 中     | 事前検証、コミュニティ事例調査、AWSサポート契約                  | Tech Lead     |

### リスク軽減策

**技術的対策**:

- すべてのGoコードにユニットテスト（カバレッジ80%以上）
- 統合テストでマルチテナント分離を厳密に検証
- pprofによる継続的なメモリ/Goroutine監視
- ステージング環境での本番同等負荷試験

**組織的対策**:

- 週次進捗レビューでブロッカー早期発見
- Week 6 GO/NO-GO判定で撤退ライン明確化
- 外部Go言語コンサルタント招聘（必要時）

---

## 📚 参考資料

### Go言語学習

- [A Tour of Go](https://go.dev/tour/)
- [Effective Go](https://go.dev/doc/effective_go)
- [Go by Example](https://gobyexample.com/)
- [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md)

### AWS SDK for Go v2

- [Developer Guide](https://aws.github.io/aws-sdk-go-v2/docs/)
- [DynamoDB Examples](https://github.com/awsdocs/aws-doc-sdk-examples/tree/main/go/dynamodb)
- [Bedrock Examples](https://github.com/awsdocs/aws-doc-sdk-examples/tree/main/go/bedrock-runtime)

### Ginフレームワーク

- [Gin Documentation](https://gin-gonic.com/docs/)
- [Gin Examples](https://github.com/gin-gonic/examples)

### パフォーマンス最適化

- [Go Performance Tips](https://github.com/dgryski/go-perfbook)
- [pprof Tutorial](https://go.dev/blog/pprof)

---

## 次のステップ

このドキュメント作成後、以下を実施します:

1. ✅ **Week 1開始**: Goトレーニング資料配布
2. ⬜ **リポジトリ作成**: `packages/api-go/` 初期化
3. ⬜ **GitHub Project作成**: タスク管理開始
4. ⬜ **Week 1キックオフミーティング**: チーム全体

---

**ドキュメントバージョン**: 1.0
**最終更新**: 2025-10-31
**次回レビュー**: Week 6（POC完了時）
