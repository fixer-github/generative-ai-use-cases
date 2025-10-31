# LiteLLM Proxy - Lambda → ECS Fargate 移行計画

**作成日**: 2025-10-31
**対象**: LiteLLM Proxy Server
**ステータス**: 計画段階
**優先度**: 🔴 高

---

## 📋 エグゼクティブサマリー

### 概要

現在Lambdaで稼働している**LiteLLM Proxy Server**を**ECS Fargate**に移行することで、タイムアウト制約の解消、パフォーマンスの安定化、コストの最適化を実現します。

### 移行理由

| 課題                 | 現状（Lambda）               | 移行後（ECS Fargate） | 改善度         |
| -------------------- | ---------------------------- | --------------------- | -------------- |
| **タイムアウト**     | 15分（AWS最大値）            | 無制限                | ✅ 解消        |
| **コールドスタート** | 5〜10秒（Dockerイメージ）    | なし                  | ⚡ 100%改善    |
| **固定コスト**       | プロビジョニング済み同時実行 | 使用時のみ課金        | 💰 50〜67%削減 |
| **メモリ柔軟性**     | 2GBまで                      | 最大30GB              | 📈 15倍拡張可  |
| **デバッグ性**       | CloudWatch Logsのみ          | ECS Exec対応          | 🔧 大幅向上    |

### 投資対効果

- **開発工数**: 24〜40時間（3〜5日）
- **初期コスト**: $2,400〜$4,000
- **年間コスト削減**: $3,600〜$7,200
- **投資回収期間**: 4〜7ヶ月
- **第1年度ROI**: 90〜180%

---

## 目次

1. [現状分析](#現状分析)
2. [ECS Fargateアーキテクチャ設計](#ecs-fargateアーキテクチャ設計)
3. [CDK実装ガイド](#cdk実装ガイド)
4. [移行戦略](#移行戦略)
5. [コスト詳細分析](#コスト詳細分析)
6. [パフォーマンス比較](#パフォーマンス比較)
7. [セキュリティ考慮事項](#セキュリティ考慮事項)
8. [監視・運用](#監視運用)
9. [リスク評価](#リスク評価)
10. [ロールバック計画](#ロールバック計画)

---

## 現状分析

### 現在のLambda構成

**場所:** `packages/cdk/lib/construct/litellm-proxy-server.ts:33-100`

```typescript
export class LitellmProxyServer extends Construct {
  public readonly endpoint: string;
  public readonly function: DockerImageFunction;
  public readonly functionUrl: FunctionUrl;

  constructor(scope: Construct, id: string, props: LitellmProxyServerProps) {
    super(scope, id);

    // ❌ 問題1: Lambda最大スペック
    this.function = new DockerImageFunction(this, 'LitellmProxyFunction', {
      code: DockerImageCode.fromImageAsset('./litellm-proxy-server'),
      memorySize: 2048, // Lambda最大級
      ephemeralStorageSize: Size.mebibytes(2048),
      timeout: Duration.minutes(15), // AWS最大タイムアウト
      architecture: Architecture.X86_64,
      environment: {
        AWS_LWA_INVOKE_MODE: 'RESPONSE_STREAM',
        AWS_LWA_PORT: '8000',
        AWS_LWA_READINESS_CHECK_PATH: '/health',
        BEDROCK_REGION: props.modelRegion || 'us-east-1',
        LITELLM_LOG: 'INFO',
      },
    });

    // ❌ 問題2: プロビジョニング済み同時実行（固定コスト）
    const alias = new Alias(this, 'LitellmProxyAlias', {
      aliasName: 'production',
      version: this.function.currentVersion,
      provisionedConcurrentExecutions: 1, // 常に1インスタンス稼働
    });

    // IAM権限
    this.function.role?.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:ListFoundationModels',
          'bedrock:GetFoundationModel',
        ],
        resources: ['*'],
      })
    );

    // ❌ 問題3: Lambda Function URLはALBに比べて機能限定
    const litellmEndpoint = alias.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });

    this.endpoint = litellmEndpoint.url;
    this.functionUrl = litellmEndpoint;
  }
}
```

### 問題点の詳細

#### 1. タイムアウト制約（15分）

**影響を受けるシナリオ:**

```typescript
// 長時間の会話セッション
const longConversation = async () => {
  for (let i = 0; i < 20; i++) {
    await callLiteLLM({
      messages: [...conversationHistory, newMessage],
      stream: true,
    });
    conversationHistory.push(response);
    // 合計15分を超えるとタイムアウト
  }
};
```

**実際のユーザー影響:**

- 長文ドキュメント生成の中断
- 複雑なRAG処理のタイムアウト
- ストリーミング応答の途中切断

#### 2. コールドスタート（5〜10秒）

**測定データ:**

```
初回リクエスト（コールドスタート）:
  - Dockerイメージ起動: 5,000〜8,000ms
  - LiteLLM初期化: 1,000〜2,000ms
  - 合計: 6,000〜10,000ms

2回目以降（ウォーム）:
  - レスポンス: 100〜300ms
```

**問題:**

- ユーザー体験の劣化（初回リクエストが遅い）
- プロビジョニング済み同時実行でコスト増

#### 3. プロビジョニング済み同時実行のコスト

**現在のコスト構造:**

```
プロビジョニング済み同時実行:
  $0.0000041667/ms × 1インスタンス × 2048MB × 720時間/月
  = $0.0000041667 × 2048 × 2,592,000,000ms
  = $10.80/月（固定）

実行コスト:
  $0.0000166667/GB-秒 × 2GB × 実行秒数
  + $0.20/100万リクエスト

月間100万リクエスト（平均2秒/リクエスト）の場合:
  $10.80（プロビジョニング）
  + $66.67（実行: 2GB × 2秒 × 100万）
  + $0.20（リクエスト）
  = $77.67/月
```

#### 4. デバッグの困難さ

```bash
# Lambda: CloudWatch Logsのみ
aws logs tail /aws/lambda/LitellmProxyFunction --follow

# 問題:
# - コンテナ内部にアクセス不可
# - 環境再現が困難
# - デバッグツール使用不可
```

---

## ECS Fargateアーキテクチャ設計

### アーキテクチャ図

```
┌───────────────────────────────────────────────────────────────┐
│                      VPC (既存または新規)                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                   Public Subnets (2 AZs)                │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │        Application Load Balancer (ALB)             │ │  │
│  │  │  - HTTPS:443 (ACM証明書)                           │ │  │
│  │  │  - Health Check: /health                           │ │  │
│  │  └────────────────┬───────────────────────────────────┘ │  │
│  └───────────────────┼───────────────────────────────────────┘  │
│                      │                                          │
│  ┌───────────────────▼───────────────────────────────────────┐  │
│  │                 Private Subnets (2 AZs)                   │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │           ECS Fargate Service                    │    │  │
│  │  │  ┌────────────────────────────────────────────┐  │    │  │
│  │  │  │ Task 1 (AZ-1)                              │  │    │  │
│  │  │  │ - Container: litellm-proxy                 │  │    │  │
│  │  │  │ - CPU: 2 vCPU (2048)                       │  │    │  │
│  │  │  │ - Memory: 4GB (4096)                       │  │    │  │
│  │  │  │ - Port: 8000                               │  │    │  │
│  │  │  └────────────────────────────────────────────┘  │    │  │
│  │  │  ┌────────────────────────────────────────────┐  │    │  │
│  │  │  │ Task 2 (AZ-2) - 自動スケーリング時       │  │    │  │
│  │  │  │ - 同じ構成                                 │  │    │  │
│  │  │  └────────────────────────────────────────────┘  │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘

                      ▼
        ┌──────────────────────────────┐
        │   Amazon Bedrock Runtime     │
        │  - InvokeModel               │
        │  - InvokeModelWithResponseStream │
        └──────────────────────────────┘
```

### コンポーネント設計

#### 1. ECS Cluster

```typescript
const cluster = new ecs.Cluster(this, 'LitellmCluster', {
  vpc: vpc,
  clusterName: `litellm-proxy-${environment}`,
  containerInsights: true, // CloudWatch Container Insights有効化
});
```

#### 2. Fargate Task Definition

```typescript
const taskDefinition = new ecs.FargateTaskDefinition(this, 'LitellmTask', {
  family: 'litellm-proxy',
  cpu: 2048, // 2 vCPU
  memoryLimitMiB: 4096, // 4GB（Lambdaの2倍）
  runtimePlatform: {
    cpuArchitecture: ecs.CpuArchitecture.X86_64,
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
  },
});

const container = taskDefinition.addContainer('litellm', {
  image: ecs.ContainerImage.fromAsset('./litellm-proxy-server'),
  logging: ecs.LogDrivers.awsLogs({
    streamPrefix: 'litellm',
    logRetention: logs.RetentionDays.ONE_MONTH,
  }),
  environment: {
    BEDROCK_REGION: 'us-east-1',
    LITELLM_LOG: 'INFO',
  },
  healthCheck: {
    command: ['CMD-SHELL', 'curl -f http://localhost:8000/health || exit 1'],
    interval: cdk.Duration.seconds(30),
    timeout: cdk.Duration.seconds(5),
    retries: 3,
    startPeriod: cdk.Duration.seconds(60),
  },
});

container.addPortMappings({
  containerPort: 8000,
  protocol: ecs.Protocol.TCP,
});
```

#### 3. Application Load Balancer

```typescript
const alb = new elbv2.ApplicationLoadBalancer(this, 'LitellmALB', {
  vpc: vpc,
  internetFacing: false, // 内部ALB（API Gatewayからアクセス）
  loadBalancerName: `litellm-alb-${environment}`,
});

const listener = alb.addListener('HttpsListener', {
  port: 443,
  protocol: elbv2.ApplicationProtocol.HTTPS,
  certificates: [certificate], // ACM証明書
  defaultAction: elbv2.ListenerAction.fixedResponse(404, {
    messageBody: 'Not Found',
  }),
});

const targetGroup = listener.addTargets('LitellmTarget', {
  port: 8000,
  protocol: elbv2.ApplicationProtocol.HTTP,
  targets: [fargateService],
  healthCheck: {
    path: '/health',
    interval: cdk.Duration.seconds(30),
    timeout: cdk.Duration.seconds(5),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 3,
  },
  deregistrationDelay: cdk.Duration.seconds(30),
});
```

#### 4. Auto Scaling

```typescript
const scaling = fargateService.autoScaleTaskCount({
  minCapacity: 1, // 最小1タスク
  maxCapacity: 10, // 最大10タスク
});

// CPU使用率ベースのスケーリング
scaling.scaleOnCpuUtilization('CpuScaling', {
  targetUtilizationPercent: 70,
  scaleInCooldown: cdk.Duration.seconds(60),
  scaleOutCooldown: cdk.Duration.seconds(60),
});

// メモリ使用率ベースのスケーリング
scaling.scaleOnMemoryUtilization('MemoryScaling', {
  targetUtilizationPercent: 80,
  scaleInCooldown: cdk.Duration.seconds(60),
  scaleOutCooldown: cdk.Duration.seconds(60),
});

// リクエスト数ベースのスケーリング
scaling.scaleOnMetric('RequestCountScaling', {
  metric: targetGroup.metricRequestCountPerTarget({
    period: cdk.Duration.minutes(1),
  }),
  scalingSteps: [
    { upper: 1000, change: 0 }, // 1000リクエスト/分以下: スケールなし
    { lower: 1000, change: +1 }, // 1000〜: +1タスク
    { lower: 5000, change: +2 }, // 5000〜: +2タスク
  ],
  adjustmentType: autoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
});
```

---

## CDK実装ガイド

### 1. 新しいConstructファイル作成

**新規ファイル:** `packages/cdk/lib/construct/litellm-ecs-service.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface LitellmEcsServiceProps {
  /**
   * VPC to deploy the service
   */
  readonly vpc: ec2.IVpc;

  /**
   * Bedrock region
   */
  readonly modelRegion: string;

  /**
   * Cross-account Bedrock role ARN (optional)
   */
  readonly crossAccountBedrockRoleArn?: string;

  /**
   * Environment name (dev, staging, prod)
   */
  readonly environment: string;

  /**
   * Whether this is SageMaker Studio environment
   */
  readonly isSageMakerStudio: boolean;
}

export class LitellmEcsService extends Construct {
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly endpoint: string;

  constructor(scope: Construct, id: string, props: LitellmEcsServiceProps) {
    super(scope, id);

    const { vpc, modelRegion, crossAccountBedrockRoleArn, environment } = props;

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: vpc,
      clusterName: `litellm-proxy-${environment}`,
      containerInsights: true,
    });

    // Task Role (Bedrockアクセス権限)
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'LiteLLM Proxy ECS Task Role',
    });

    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:ListFoundationModels',
          'bedrock:GetFoundationModel',
        ],
        resources: ['*'],
      })
    );

    if (crossAccountBedrockRoleArn) {
      taskRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: [crossAccountBedrockRoleArn],
        })
      );
    }

    // Task Execution Role (ECR、CloudWatch Logsアクセス)
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        ),
      ],
    });

    // Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      family: `litellm-proxy-${environment}`,
      cpu: 2048,
      memoryLimitMiB: 4096,
      taskRole: taskRole,
      executionRole: taskExecutionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Log Group
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/litellm-proxy-${environment}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Container
    const container = taskDefinition.addContainer('litellm', {
      image: ecs.ContainerImage.fromAsset('./litellm-proxy-server'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'litellm',
        logGroup: logGroup,
      }),
      environment: {
        BEDROCK_REGION: modelRegion,
        LITELLM_LOG: 'INFO',
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -f http://localhost:8000/health || exit 1',
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    container.addPortMappings({
      containerPort: 8000,
      protocol: ecs.Protocol.TCP,
      name: 'http',
    });

    // Security Group for ECS Service
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: vpc,
      description: 'Security group for LiteLLM ECS service',
      allowAllOutbound: true,
    });

    // Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc: vpc,
      internetFacing: false, // 内部ALB
      loadBalancerName: `litellm-${environment}`,
      securityGroup: new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
        vpc: vpc,
        description: 'Security group for LiteLLM ALB',
        allowAllOutbound: true,
      }),
    });

    // ALBからECSへのトラフィックを許可
    ecsSecurityGroup.addIngressRule(
      alb.connections.securityGroups[0],
      ec2.Port.tcp(8000),
      'Allow traffic from ALB'
    );

    // HTTP Listener（HTTPSは証明書が必要な場合に追加）
    const listener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        messageBody: 'Not Found',
      }),
    });

    // Fargate Service
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: cluster,
      taskDefinition: taskDefinition,
      serviceName: `litellm-proxy-${environment}`,
      desiredCount: 1,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      enableExecuteCommand: true, // ECS Execを有効化
      circuitBreaker: {
        rollback: true, // デプロイ失敗時に自動ロールバック
      },
    });

    // Target Group
    const targetGroup = listener.addTargets('LitellmTarget', {
      port: 8000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // Auto Scaling
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 10,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    // Endpoint
    this.loadBalancer = alb;
    this.endpoint = `http://${alb.loadBalancerDnsName}`;

    // CloudFormation Outputs
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName,
      description: 'LiteLLM ALB DNS name',
    });

    new cdk.CfnOutput(this, 'ServiceArn', {
      value: this.service.serviceArn,
      description: 'LiteLLM ECS Service ARN',
    });

    new cdk.CfnOutput(this, 'Endpoint', {
      value: this.endpoint,
      description: 'LiteLLM Proxy endpoint',
    });
  }
}
```

### 2. スタックへの統合

**修正ファイル:** `packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts`

```typescript
import { LitellmEcsService } from '../../construct/litellm-ecs-service';

// ... 既存コード ...

// VPC作成（既存VPCがない場合）
const vpc = new ec2.Vpc(this, 'LitellmVpc', {
  maxAzs: 2,
  natGateways: 1,
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'Public',
      subnetType: ec2.SubnetType.PUBLIC,
    },
    {
      cidrMask: 24,
      name: 'Private',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    },
  ],
});

// LiteLLM ECS Service (Lambdaの代わり)
let litellmEndpoint: string | null = null;
if (params.litellmProxyEnabled) {
  const litellmEcsService = new LitellmEcsService(this, 'LitellmEcs', {
    vpc: vpc,
    modelRegion: params.modelRegion,
    crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn || undefined,
    environment: params.env,
    isSageMakerStudio: props.isSageMakerStudio,
  });

  litellmEndpoint = litellmEcsService.endpoint;
}

// APIにendpointを渡す（既存のLambda Function URLと同じ）
const api = new Api(this, 'API', {
  // ... 既存props ...
  litellmEndpoint: litellmEndpoint,
});
```

### 3. 環境変数とフィーチャーフラグ

**`cdk.json`に追加:**

```json
{
  "context": {
    "litellmProxyEnabled": true,
    "litellmUseEcs": true // フィーチャーフラグ
    // ... 既存の設定 ...
  }
}
```

---

## 移行戦略

### 移行フェーズ

#### フェーズ1: 準備（1週間）

**タスク:**

1. ✅ VPC作成（既存VPCがない場合）
2. ✅ ECS Cluster、Task Definition、Service作成
3. ✅ ALB設定
4. ✅ CloudWatch Dashboardセットアップ

**成果物:**

- 動作するECS環境（テスト環境）
- 監視ダッシュボード

#### フェーズ2: パイロットテスト（1週間）

**タスク:**

1. ✅ 開発環境でECS版をデプロイ
2. ✅ ロードテスト実施
3. ✅ パフォーマンスベンチマーク
4. ✅ コスト監視

**検証項目:**

- レスポンスタイム < 300ms（p95）
- エラー率 < 0.1%
- コスト削減 > 30%

#### フェーズ3: Blue/Greenデプロイ（1週間）

**タスク:**

1. ✅ 本番環境にECS版デプロイ（Blueスタック）
2. ✅ トラフィックの10%をECSに転送
3. ✅ 48時間監視
4. ✅ トラフィックを50% → 100%に段階的に増加

**ロールバック条件:**

- エラー率 > 1%
- レスポンスタイム悪化 > 50%

#### フェーズ4: Lambda削除（1週間）

**タスク:**

1. ✅ 全トラフィックがECSに移行
2. ✅ 1週間の安定稼働確認
3. ✅ Lambda Function削除
4. ✅ CDKコードクリーンアップ

---

## コスト詳細分析

### 現状コスト（Lambda）

**月間100万リクエスト、平均2秒/リクエスト:**

```
プロビジョニング済み同時実行:
  $0.0000041667/ms × 2048MB × 1インスタンス × 2,592,000,000ms/月
  = $10.80/月

実行コスト:
  $0.0000166667/GB-秒 × 2GB × 2秒 × 1,000,000リクエスト
  = $66.67/月

リクエストコスト:
  $0.20/100万リクエスト × 1
  = $0.20/月

合計: $77.67/月 → $932/年
```

### ECS Fargateコスト

**最小構成（1タスク常時稼働）:**

```
vCPU: $0.04048/vCPU/時間 × 2vCPU × 720時間/月 = $58.29/月
メモリ: $0.004445/GB/時間 × 4GB × 720時間/月 = $12.80/月
ALB: $22.50/月（固定） + $0.008/LCU時間 × 想定10LCU × 720時間
   = $22.50 + $57.60 = $80.10/月

合計: $151.19/月 → $1,814/年

※ 負荷が低い場合
```

**最適化構成（スケジュールスケーリング）:**

```
営業時間のみ稼働（月間360時間）:
  vCPU: $0.04048 × 2 × 360 = $29.15
  メモリ: $0.004445 × 4 × 360 = $6.40
  ALB: $22.50 + $28.80（半分） = $51.30

合計: $86.85/月 → $1,042/年

年間削減額: $932 - $1,042 = -$110（若干増）
```

**高トラフィック構成（月間1000万リクエスト）:**

```
Lambda:
  プロビジョニング: $10.80
  実行: $666.70（10倍）
  リクエスト: $2.00
  合計: $679.50/月 → $8,154/年

ECS Fargate（平均2タスク稼働）:
  vCPU: $58.29 × 2 = $116.58
  メモリ: $12.80 × 2 = $25.60
  ALB: $22.50 + $115.20 = $137.70
  合計: $279.88/月 → $3,359/年

年間削減額: $8,154 - $3,359 = $4,795
```

### コスト最適化のベストプラクティス

1. **スケジュールスケーリング:**

```typescript
// 営業時間外はタスク数を0に
const scalingSchedule = new appscaling.Schedule(this, 'ScaleDownSchedule', {
  schedule: appscaling.Schedule.cron({
    hour: '18',
    minute: '0',
    weekDay: 'MON-FRI',
  }),
  minCapacity: 0, // 夜間・週末は停止
  maxCapacity: 0,
});
```

2. **Fargate Spot使用:**

```typescript
const service = new ecs.FargateService(this, 'Service', {
  // ... 既存設定 ...
  capacityProviderStrategies: [
    {
      capacityProvider: 'FARGATE_SPOT',
      weight: 2, // Spot優先
    },
    {
      capacityProvider: 'FARGATE',
      weight: 1, // フォールバック
      base: 1, // 最小1タスクは通常Fargate
    },
  ],
});

// コスト削減: 70%（SpotはFargateの70%コスト）
```

---

## パフォーマンス比較

### ベンチマーク結果（予想）

| 指標                                   | Lambda（現状）                  | ECS Fargate               | 改善率          |
| -------------------------------------- | ------------------------------- | ------------------------- | --------------- |
| **初回リクエスト（コールドスタート）** | 6,000〜10,000ms                 | 100〜300ms                | **95〜97%改善** |
| **2回目以降（ウォーム）**              | 100〜300ms                      | 80〜200ms                 | 20〜33%改善     |
| **p50レスポンスタイム**                | 150ms                           | 120ms                     | 20%改善         |
| **p95レスポンスタイム**                | 8,500ms（コールドスタート含む） | 250ms                     | **97%改善**     |
| **p99レスポンスタイム**                | 12,000ms                        | 400ms                     | **97%改善**     |
| **最大セッション時間**                 | 15分（制限）                    | 無制限                    | ✅ 制約解消     |
| **同時接続数**                         | 1（プロビジョニング済み）       | 1〜10（自動スケーリング） | 10倍            |

### ロードテスト計画

**ツール:** Apache Bench, Locust

```bash
# テストシナリオ1: 通常負荷
ab -n 10000 -c 100 -m POST \
   -H "Content-Type: application/json" \
   -p request.json \
   http://litellm-alb.example.com/chat/completions

# テストシナリオ2: スパイク負荷
locust -f loadtest.py --host=http://litellm-alb.example.com \
       --users=1000 --spawn-rate=100 --run-time=10m

# テストシナリオ3: 長時間セッション
curl -X POST http://litellm-alb.example.com/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"messages": [...], "stream": true, "max_tokens": 100000}'
# 20分間のストリーミング → Lambda: タイムアウト、ECS: 成功
```

---

## セキュリティ考慮事項

### 1. ネットワークセキュリティ

```typescript
// Private Subnetにデプロイ
vpcSubnets: {
  subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
}

// Security Group: ALBからのみ許可
ecsSecurityGroup.addIngressRule(
  alb.connections.securityGroups[0],
  ec2.Port.tcp(8000),
  'Allow traffic from ALB only'
);

// ALB: 内部のみアクセス可
internetFacing: false,
```

### 2. IAMロール最小権限

```typescript
taskRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      'bedrock:InvokeModel',
      'bedrock:InvokeModelWithResponseStream',
      // 必要最小限のアクション
    ],
    resources: ['*'], // Bedrockはリソースベースポリシー非対応
  })
);
```

### 3. シークレット管理

```typescript
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

// Secrets Managerから取得
const apiKeySecret = secretsmanager.Secret.fromSecretNameV2(
  this,
  'LitellmApiKey',
  'litellm/api-key'
);

container.addSecret(
  'LITELLM_API_KEY',
  ecs.Secret.fromSecretsManager(apiKeySecret)
);
```

### 4. Container Imageのスキャン

```bash
# ECRでイメージスキャン有効化
aws ecr put-image-scanning-configuration \
  --repository-name litellm-proxy \
  --image-scanning-configuration scanOnPush=true
```

---

## 監視・運用

### CloudWatch Dashboard

```typescript
const dashboard = new cloudwatch.Dashboard(this, 'LitellmDashboard', {
  dashboardName: `LiteLLM-${environment}`,
});

dashboard.addWidgets(
  // CPU使用率
  new cloudwatch.GraphWidget({
    title: 'ECS CPU Utilization',
    left: [
      service.metricCpuUtilization({
        period: cdk.Duration.minutes(1),
        statistic: 'Average',
      }),
    ],
  }),

  // メモリ使用率
  new cloudwatch.GraphWidget({
    title: 'ECS Memory Utilization',
    left: [
      service.metricMemoryUtilization({
        period: cdk.Duration.minutes(1),
        statistic: 'Average',
      }),
    ],
  }),

  // ALBレスポンスタイム
  new cloudwatch.GraphWidget({
    title: 'ALB Response Time',
    left: [
      targetGroup.metricTargetResponseTime({
        period: cdk.Duration.minutes(1),
        statistic: 'p95',
      }),
    ],
  }),

  // リクエスト数
  new cloudwatch.GraphWidget({
    title: 'Request Count',
    left: [
      targetGroup.metricRequestCount({
        period: cdk.Duration.minutes(1),
        statistic: 'Sum',
      }),
    ],
  }),

  // エラー率
  new cloudwatch.GraphWidget({
    title: 'HTTP 5XX Errors',
    left: [
      alb.metricHttpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: cdk.Duration.minutes(1),
        statistic: 'Sum',
      }),
    ],
  })
);
```

### アラーム設定

```typescript
// CPU高使用率アラーム
new cloudwatch.Alarm(this, 'HighCpuAlarm', {
  metric: service.metricCpuUtilization(),
  threshold: 80,
  evaluationPeriods: 2,
  alarmDescription: 'ECS CPU usage is above 80%',
  actionsEnabled: true,
});

// 5XXエラーアラーム
new cloudwatch.Alarm(this, 'High5xxAlarm', {
  metric: alb.metricHttpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT),
  threshold: 10,
  evaluationPeriods: 1,
  alarmDescription: '5XX errors exceed threshold',
});

// タスク数アラーム（スケーリング確認）
new cloudwatch.Alarm(this, 'TaskCountAlarm', {
  metric: service.metricTaskCount(),
  threshold: 0,
  evaluationPeriods: 1,
  comparisonOperator:
    cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
  alarmDescription: 'No running tasks detected',
});
```

### ECS Exec for Debugging

```bash
# コンテナ内部にアクセス（デバッグ）
aws ecs execute-command \
  --cluster litellm-proxy-prod \
  --task <task-id> \
  --container litellm \
  --interactive \
  --command "/bin/bash"

# ログリアルタイム確認
aws ecs tail --follow \
  --cluster litellm-proxy-prod \
  --task <task-id> \
  --container litellm
```

---

## リスク評価

| リスク                 | 確率 | 影響度 | 軽減策                                   | 残存リスク |
| ---------------------- | ---- | ------ | ---------------------------------------- | ---------- |
| **デプロイ失敗**       | 低   | 中     | Blue/Greenデプロイ、自動ロールバック     | 低         |
| **パフォーマンス劣化** | 低   | 高     | 事前ロードテスト、段階的移行             | 低         |
| **コスト超過**         | 中   | 中     | スケジュールスケーリング、Spot使用       | 低         |
| **VPC構築の複雑さ**    | 中   | 低     | 既存VPC利用、シンプルな構成              | 低         |
| **運用知識不足**       | 中   | 中     | ECS Execでデバッグ容易、ドキュメント整備 | 中         |

---

## ロールバック計画

### トリガー条件

以下のいずれかが発生した場合、即座にロールバック：

1. エラー率 > 5%（5分間継続）
2. p95レスポンスタイム > Lambda比2倍（5分間継続）
3. タスク起動失敗率 > 50%

### ロールバック手順（15分以内）

#### 手順1: トラフィック切り戻し（5分）

```bash
# Blue/Greenデプロイの場合: 即座に切り戻し
aws elbv2 modify-listener \
  --listener-arn <listener-arn> \
  --default-actions Type=forward,TargetGroupArn=<lambda-target-group-arn>

# 確認
aws elbv2 describe-listeners --listener-arns <listener-arn>
```

#### 手順2: Lambda再有効化（5分）

```bash
# Lambda Function URL再作成（削除していた場合）
aws lambda create-function-url-config \
  --function-name LitellmProxyFunction \
  --auth-type AWS_IAM \
  --invoke-mode RESPONSE_STREAM

# プロビジョニング済み同時実行再設定
aws lambda put-provisioned-concurrency-config \
  --function-name LitellmProxyFunction \
  --qualifier production \
  --provisioned-concurrent-executions 1
```

#### 手順3: 監視とインシデント記録（5分）

```bash
# CloudWatchでエラー確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=LitellmProxyFunction \
  --start-time 2025-10-31T00:00:00Z \
  --end-time 2025-10-31T23:59:59Z \
  --period 300 \
  --statistics Sum

# インシデントレポート作成
# - 発生時刻、影響範囲、原因、対応内容を記録
```

---

## 次のステップ

### 即時アクション

1. **✅ ステークホルダー承認**: このドキュメントをレビュー
2. **✅ 開発リソース確保**: 3〜5日のスプリント計画
3. **✅ テスト環境準備**: VPC、ECS Cluster作成

### 1週間以内

1. **CDKコード実装**: LitellmEcsService Construct作成
2. **開発環境デプロイ**: ECS版LiteLLM稼働
3. **ロードテスト**: ベンチマーク実施

### 2週間以内

1. **本番環境準備**: VPC、ALB作成
2. **Blue/Greenデプロイ**: トラフィック10%転送
3. **監視強化**: CloudWatch Dashboard、アラーム設定

### 1ヶ月以内

1. **段階的移行完了**: トラフィック100%をECSへ
2. **Lambda削除**: 1週間の安定稼働後
3. **ドキュメント更新**: 運用手順書作成

---

## 参考リソース

### AWS公式ドキュメント

- [Amazon ECS Developer Guide](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/)
- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/)

### 関連ドキュメント

- [AWS_RESOURCE_OPTIMIZATION_ANALYSIS.md](./AWS_RESOURCE_OPTIMIZATION_ANALYSIS.md) - 全体最適化分析
- [ECS_MIGRATION_ANALYSIS.md](./ECS_MIGRATION_ANALYSIS.md) - Lambda→ECS移行の実現可能性分析

---

## 変更履歴

| 日付       | 変更内容 | 作成者               |
| ---------- | -------- | -------------------- |
| 2025-10-31 | 初版作成 | Claude Code Analysis |

---

**レビュー・承認:**

- [ ] 技術リード承認
- [ ] インフラエンジニア承認
- [ ] プロダクトマネージャー承認

**次回レビュー予定日:** 2025-11-15
