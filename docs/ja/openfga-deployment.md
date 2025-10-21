# OpenFGA デプロイメントガイド

## 概要

このガイドでは、ECS Fargate上にOpenFGAをデプロイする手順を説明します。

## 前提条件

- AWS CLIがインストールされ、設定済み
- Node.js 20.x以上
- AWS CDKがインストール済み (`npm install -g aws-cdk`)
- VPCが作成済み

## アーキテクチャ

```
┌─────────────┐
│ API Gateway │
└──────┬──────┘
       │
       ▼
┌──────────────────┐      ┌────────────────┐
│ Lambda Authorizer│─────▶│ OpenFGA (ECS)  │
└──────────────────┘      └────────┬───────┘
                                   │
                          ┌────────▼────────┐
                          │ RDS PostgreSQL  │
                          └─────────────────┘
```

## Step 1: CDKスタック作成

```typescript
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { OpenFGADatabase, OpenFGAService } from '../lib/construct/openfga';

export class OpenFGAStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // VPCの取得または作成
    const vpc = Vpc.fromLookup(this, 'VPC', {
      isDefault: true,
    });

    // PostgreSQLデータベース作成
    const database = new OpenFGADatabase(this, 'Database', {
      vpc,
      environment: 'poc',
      multiAz: false, // POCでは単一AZ
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO),
    });

    // OpenFGAサービス作成
    const openFGA = new OpenFGAService(this, 'Service', {
      vpc,
      database,
      environment: 'poc',
      desiredCount: 2,
      cpu: 256,
      memoryLimitMiB: 512,
      publicLoadBalancer: false, // 内部ALB
      enablePlayground: false, // 本番では無効化
    });

    // 出力
    new CfnOutput(this, 'OpenFGAEndpoint', {
      value: openFGA.endpoint,
      description: 'OpenFGA HTTP endpoint',
    });

    new CfnOutput(this, 'OpenFGAGrpcEndpoint', {
      value: openFGA.grpcEndpoint,
      description: 'OpenFGA gRPC endpoint',
    });
  }
}
```

## Step 2: デプロイ

```bash
# CDKブートストラップ (初回のみ)
cdk bootstrap

# スタックデプロイ
cdk deploy OpenFGAStack

# 出力されたエンドポイントを記録
# OpenFGAEndpoint = http://openfga-poc-ALB-xxx.us-east-1.elb.amazonaws.com:8080
# OpenFGAGrpcEndpoint = openfga-poc-ALB-xxx.us-east-1.elb.amazonaws.com:8081
```

## Step 3: データベースマイグレーション

OpenFGAは初回起動時に自動的にデータベースマイグレーションを実行します。

ログで確認:

```bash
# CloudWatch Logsで確認
aws logs tail /ecs/openfga-poc --follow

# 期待されるログ:
# "msg":"migrating datastore","module":"datastore","method":"postgres"
# "msg":"migration complete"
```

## Step 4: ストア作成

```bash
# OpenFGA CLIをインストール
brew install openfga/tap/fga

# または
go install github.com/openfga/cli/cmd/fga@latest

# ストア作成
fga store create --name "tenant-poc" \
  --api-url http://your-alb-endpoint:8080

# 出力例:
# {
#   "id": "01HQXYZ123456789ABCDEF",
#   "name": "tenant-poc",
#   "created_at": "2025-10-21T10:00:00Z"
# }

# Store IDを環境変数に保存
export OPENFGA_STORE_ID="01HQXYZ123456789ABCDEF"
```

## Step 5: スキーマ適用

```bash
# スキーマファイルの場所
cd packages/cdk/lib/construct/openfga

# スキーマをアップロード
fga model write \
  --store-id $OPENFGA_STORE_ID \
  --file authorization-schema.fga \
  --api-url http://your-alb-endpoint:8080

# モデルIDを確認
fga model list \
  --store-id $OPENFGA_STORE_ID \
  --api-url http://your-alb-endpoint:8080
```

## Step 6: サンプルデータ投入

```bash
# テナント作成
fga tuple write \
  --store-id $OPENFGA_STORE_ID \
  --api-url http://your-alb-endpoint:8080 \
  user:alice tenant:acme#member

# プラン割り当て
fga tuple write \
  --store-id $OPENFGA_STORE_ID \
  --api-url http://your-alb-endpoint:8080 \
  tenant:acme plan:pro#subscriber

# ユースケース権限
fga tuple write \
  --store-id $OPENFGA_STORE_ID \
  --api-url http://your-alb-endpoint:8080 \
  usecase:chat plan:pro#allowed_usecase

# モデル権限
fga tuple write \
  --store-id $OPENFGA_STORE_ID \
  --api-url http://your-alb-endpoint:8080 \
  model:claude-3-sonnet plan:pro#allowed_model
```

## Step 7: 権限チェックテスト

```bash
# ユーザーがチャット機能を使えるか?
fga query check \
  --store-id $OPENFGA_STORE_ID \
  --api-url http://your-alb-endpoint:8080 \
  user:alice execute usecase:chat

# 期待される出力:
# {
#   "allowed": true
# }

# モデルを使えるか?
fga query check \
  --store-id $OPENFGA_STORE_ID \
  --api-url http://your-alb-endpoint:8080 \
  user:alice execute model:claude-3-sonnet

# クォータ付きチェック (Lambda Authorizerで実装)
```

## Step 8: Lambda Authorizer設定

```typescript
import { AuthorizationSystem } from '../lib/construct/authorization/authorization-system';

// AuthorizationSystemをOpenFGA対応に更新
const authSystem = new AuthorizationSystem(this, 'AuthSystem', {
  userPool: cognito.userPool,
  userPoolClientId: cognito.userPoolClient.userPoolClientId,
  openFGAEndpoint: openFGA.endpoint,
  openFGAStoreId: process.env.OPENFGA_STORE_ID!,
  openFGAKeySecretArn: openFGA.presharedKeysSecret.secretArn,
  vpc: vpc,
});

// API Gatewayに適用
const api = new RestApi(this, 'Api', {
  defaultMethodOptions: {
    authorizer: new RequestAuthorizer(this, 'Authorizer', {
      handler: authSystem.authorizerFunction,
      identitySources: ['method.request.header.Authorization'],
      resultsCacheTtl: Duration.minutes(5),
    }),
  },
});
```

## トラブルシューティング

### 問題: データベース接続エラー

```
ERROR: could not connect to database: connection refused
```

**解決策:**
- セキュリティグループを確認
- RDSエンドポイントが正しいか確認
- VPCサブネットとルーティングを確認

```bash
# ECSタスクからRDSへの接続テスト
aws ecs execute-command \
  --cluster openfga-poc \
  --task <task-id> \
  --container openfga \
  --command "pg_isready -h <rds-endpoint> -p 5432" \
  --interactive
```

### 問題: 認証エラー

```
ERROR: authentication failed: invalid preshared key
```

**解決策:**
- Secrets Managerのキーを確認
- 環境変数 `OPENFGA_AUTHN_PRESHARED_KEYS` を確認

```bash
# シークレット確認
aws secretsmanager get-secret-value \
  --secret-id /openfga/poc/preshared-keys \
  --query SecretString \
  --output text | jq .
```

### 問題: パフォーマンス低下

```
WARNING: check latency > 100ms
```

**解決策:**
- キャッシュが有効か確認
- Fargateタスク数を増やす
- RDSインスタンスをスケールアップ

```bash
# メトリクス確認
aws cloudwatch get-metric-statistics \
  --namespace Authorization/OpenFGA \
  --metric-name OpenFGACheckLatency \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Average,Maximum
```

## モニタリング

### CloudWatchダッシュボード作成

```typescript
import { Dashboard, GraphWidget } from 'aws-cdk-lib/aws-cloudwatch';

const dashboard = new Dashboard(this, 'OpenFGADashboard', {
  dashboardName: 'OpenFGA-POC',
});

dashboard.addWidgets(
  new GraphWidget({
    title: 'Authorization Latency',
    left: [authSystem.authorizerFunction.metricDuration()],
    right: [/* OpenFGA check latency metric */],
  })
);
```

### アラーム設定

```typescript
import { Alarm, ComparisonOperator } from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';

const highLatencyAlarm = new Alarm(this, 'HighLatency', {
  metric: /* OpenFGA latency metric */,
  threshold: 100,
  evaluationPeriods: 2,
  comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
});

highLatencyAlarm.addAlarmAction(new SnsAction(alertTopic));
```

## 次のステップ

- [ ] 負荷テスト実施 (k6/Locust)
- [ ] パフォーマンスチューニング
- [ ] マルチテナントストア管理の自動化
- [ ] 本番環境へのデプロイ計画

## 参考資料

- [OpenFGA Documentation](https://openfga.dev/docs)
- [OpenFGA API Reference](https://openfga.dev/api/service)
- [AWS ECS Fargate Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
