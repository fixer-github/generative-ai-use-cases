# OpenFGA Phase 2 デプロイメントチェックリスト

## 📋 事前準備

### 環境変数設定

```bash
# AWS環境
export AWS_PROFILE=your-profile
export AWS_REGION=us-east-1

# OpenFGA設定 (デプロイ後に設定)
export OPENFGA_API_URL="http://your-alb-endpoint:8080"
export OPENFGA_STORE_ID="will-be-created"
export OPENFGA_API_TOKEN="from-secrets-manager"

# Cognito設定
export COGNITO_USER_POOL_ID="your-pool-id"
export COGNITO_CLIENT_ID="your-client-id"
```

### 必要なツール

- [ ] AWS CLI v2インストール済み
- [ ] Node.js 20.x インストール済み
- [ ] AWS CDK インストール済み (`npm install -g aws-cdk`)
- [ ] OpenFGA CLI インストール済み (`brew install openfga/tap/fga`)
- [ ] k6 インストール済み (`brew install k6`)
- [ ] jq インストール済み (`brew install jq`)

## Day 1: インフラデプロイ

### Step 1: CDKブートストラップ

```bash
cd packages/cdk

# 初回のみ
cdk bootstrap

# 確認
cdk list
```

**期待される出力:**
```
OpenFGAStack
```

### Step 2: OpenFGAスタックデプロイ

```bash
# デプロイ
cdk deploy OpenFGAStack --require-approval never

# 所要時間: 約10-15分
```

**成功の確認:**
- [ ] CloudFormation スタック `OpenFGAStack` が `CREATE_COMPLETE`
- [ ] ECS クラスタ `openfga-poc` が作成済み
- [ ] Fargate サービス実行中 (2タスク)
- [ ] RDS インスタンス `available`
- [ ] ALB `active`

**エンドポイント記録:**
```bash
# 出力から記録
OPENFGA_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name OpenFGAStack \
  --query 'Stacks[0].Outputs[?OutputKey==`OpenFGAEndpoint`].OutputValue' \
  --output text)

echo "OpenFGA Endpoint: $OPENFGA_ENDPOINT"
```

### Step 3: ヘルスチェック

```bash
# OpenFGAヘルスチェック
curl -v $OPENFGA_ENDPOINT/healthz

# 期待される応答: HTTP 200
```

**トラブルシューティング:**
- タイムアウト → セキュリティグループ確認
- 503 エラー → ECSタスク起動確認
- DB接続エラー → RDSセキュリティグループ確認

### Step 4: ログ確認

```bash
# CloudWatch Logs確認
aws logs tail /ecs/openfga-poc --follow

# 期待されるログ:
# "msg":"migrating datastore"
# "msg":"migration complete"
# "msg":"server starting"
```

## Day 2: スキーマ・データ投入

### Step 5: ストア作成

```bash
cd packages/cdk/lib/construct/openfga

# ストア作成
fga store create \
  --name "approval-system-poc" \
  --api-url $OPENFGA_ENDPOINT

# Store IDを記録
export OPENFGA_STORE_ID="<returned-store-id>"
```

**成功の確認:**
- [ ] Store ID取得済み
- [ ] Store名 `approval-system-poc` で作成

### Step 6: 認可モデル適用

```bash
# スキーマアップロード
fga model write \
  --store-id $OPENFGA_STORE_ID \
  --file authorization-schema.fga \
  --api-url $OPENFGA_ENDPOINT

# モデル確認
fga model list \
  --store-id $OPENFGA_STORE_ID \
  --api-url $OPENFGA_ENDPOINT
```

**成功の確認:**
- [ ] Authorization model ID取得
- [ ] エラーなく完了

### Step 7: テストデータ投入

```bash
# テナント作成
fga tuple write --store-id $OPENFGA_STORE_ID \
  user:alice tenant:acme#member

fga tuple write --store-id $OPENFGA_STORE_ID \
  user:bob tenant:acme#admin

# プラン割り当て
fga tuple write --store-id $OPENFGA_STORE_ID \
  tenant:acme plan:pro#subscriber

# ユースケース権限
fga tuple write --store-id $OPENFGA_STORE_ID \
  usecase:chat plan:pro#allowed_usecase

fga tuple write --store-id $OPENFGA_STORE_ID \
  usecase:rag plan:pro#allowed_usecase

# モデル権限
fga tuple write --store-id $OPENFGA_STORE_ID \
  model:claude-3-sonnet plan:pro#allowed_model
```

**成功の確認:**
- [ ] すべてのタプル書き込み成功
- [ ] エラーなし

### Step 8: 権限チェックテスト

```bash
# テストスクリプト実行
cd ../../../../scripts
./test-openfga.sh

# 期待される結果: 18/18 tests passed
```

**成功の確認:**
- [ ] テスト18件全て通過
- [ ] エラーなし

## Day 3: Lambda Authorizer統合

### Step 9: Lambda関数デプロイ

```bash
cd ../packages/cdk

# Lambda関数デプロイ
cdk deploy AuthorizationStack --require-approval never
```

**成功の確認:**
- [ ] Lambda関数 `openfga-authorizer` デプロイ済み
- [ ] 環境変数設定済み
- [ ] VPC接続設定済み

### Step 10: API Gateway統合

```bash
# API Gateway Authorizer作成 (CDKで自動)
# 手動確認:

aws apigateway get-authorizers \
  --rest-api-id <your-api-id>
```

**成功の確認:**
- [ ] RequestAuthorizer作成済み
- [ ] Lambda関数接続済み

### Step 11: 統合テスト

```bash
# テスト用JWTトークン取得 (Cognitoから)
export TEST_JWT="<your-test-token>"

# API呼び出しテスト
curl -H "Authorization: Bearer $TEST_JWT" \
  https://your-api-gateway/api/conversations

# 期待される応答: 200 OK (認可成功)
```

**成功の確認:**
- [ ] 認可成功 (200)
- [ ] CloudWatch Logsに認可ログ記録
- [ ] メトリクス送信確認

## Day 4: パフォーマンステスト

### Step 12: 負荷テスト実行

```bash
cd scripts

# k6パフォーマンステスト
k6 run --vus 10 --duration 30s perf-test-openfga.js

# 段階的負荷テスト
k6 run perf-test-openfga.js
```

**測定項目:**
- [ ] P50 レイテンシー記録
- [ ] P95 レイテンシー記録
- [ ] P99 レイテンシー記録
- [ ] エラー率記録
- [ ] スループット記録

**目標値:**
- P95 < 100ms ✅
- P99 < 200ms ✅
- エラー率 < 1% ✅
- スループット > 100 req/s ✅

### Step 13: オートスケール検証

```bash
# 高負荷テスト
k6 run --vus 100 --duration 5m perf-test-openfga.js

# 別ターミナルでタスク数監視
watch -n 5 'aws ecs describe-services \
  --cluster openfga-poc \
  --services openfga-service \
  --query "services[0].runningCount"'
```

**成功の確認:**
- [ ] タスク数が2→4→6と増加
- [ ] CPU/メモリ使用率が閾値で安定
- [ ] レイテンシーが許容範囲内

## Day 5: チューニング・最適化

### Step 14: メトリクス分析

```bash
# CloudWatchメトリクス確認
aws cloudwatch get-metric-statistics \
  --namespace Authorization/OpenFGA \
  --metric-name OpenFGACheckLatency \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum,Minimum
```

**分析項目:**
- [ ] レイテンシー分布確認
- [ ] エラー率確認
- [ ] キャッシュヒット率確認

### Step 15: 必要に応じてチューニング

**高レイテンシーの場合:**
```typescript
// openfga-service.ts
cpu: 512,          // 256 → 512に増加
memoryLimitMiB: 1024,  // 512 → 1024に増加
```

**DB接続エラーの場合:**
- RDS Proxy追加検討
- max_connections調整

**キャッシュミス多い場合:**
```bash
# キャッシュTTL延長
OPENFGA_CHECK_QUERY_CACHE_TTL: '10m'  # 5m → 10m
```

### Step 16: コスト確認

```bash
# AWS Cost Explorer確認
aws ce get-cost-and-usage \
  --time-period Start=$(date -d '7 days ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity DAILY \
  --metrics BlendedCost \
  --filter file://cost-filter.json
```

**目標:**
- [ ] 日額 < $3 (週額 $21以下)
- [ ] 月額予測 $50-70

## Week 2: ドキュメント・報告

### Step 17: パフォーマンスレポート作成

**含めるべき内容:**
- [ ] レイテンシー測定結果 (P50/P95/P99)
- [ ] スループット測定結果
- [ ] エラー率
- [ ] オートスケール動作確認
- [ ] コスト実績

### Step 18: リスク評価更新

**評価項目:**
- [ ] 技術的リスク
- [ ] 運用リスク
- [ ] コストリスク
- [ ] セキュリティリスク

### Step 19: Phase 3計画

**Phase 3タスク:**
- [ ] 全Lambda関数の移行
- [ ] マルチテナントストア管理自動化
- [ ] 本番環境デプロイ準備
- [ ] Stripe連携 (将来)

### Step 20: Go/No-go判定

**判定基準:**

✅ **GO条件 (すべて満たす必要):**
- [ ] パフォーマンス目標達成 (P95 < 100ms)
- [ ] エラー率 < 1%
- [ ] コスト予測が目標範囲内 ($50-70/月)
- [ ] セキュリティ要件満たす
- [ ] 運用負荷がSpiceDB比で軽減

❌ **NO-GO条件 (いずれか該当):**
- [ ] 重大なバグ・脆弱性発見
- [ ] パフォーマンスが要件未達成
- [ ] コストが予算超過
- [ ] 運用が複雑すぎる

## トラブルシューティング

### 一般的な問題

#### 1. デプロイ失敗

```bash
# スタック状態確認
aws cloudformation describe-stacks --stack-name OpenFGAStack

# イベント確認
aws cloudformation describe-stack-events --stack-name OpenFGAStack | head -20

# ロールバック
cdk destroy OpenFGAStack
```

#### 2. タスク起動失敗

```bash
# タスク状態確認
aws ecs describe-tasks \
  --cluster openfga-poc \
  --tasks $(aws ecs list-tasks --cluster openfga-poc --query 'taskArns[0]' --output text)

# ログ確認
aws logs tail /ecs/openfga-poc --follow
```

#### 3. DB接続エラー

```bash
# セキュリティグループ確認
aws ec2 describe-security-groups --group-ids <sg-id>

# RDS状態確認
aws rds describe-db-instances --db-instance-identifier <db-id>
```

## 完了チェック

Phase 2完了時に確認:

- [ ] OpenFGA稼働中 (2+ tasks)
- [ ] RDS健全
- [ ] Lambda Authorizer機能
- [ ] テスト18件全通過
- [ ] パフォーマンス目標達成
- [ ] コスト予測妥当
- [ ] ドキュメント完成
- [ ] Go/No-go判定完了

## 次のステップ

**GOの場合:**
→ Phase 3: 本番移行準備

**NO-GOの場合:**
→ 課題解決 または SpiceDB継続検討
