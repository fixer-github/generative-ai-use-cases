# OpenSearch Serverless 移行計画

**作成日**: 2025-10-31
**対象**: OpenSearch Domain (Managed) → OpenSearch Serverless
**ステータス**: 計画段階
**優先度**: 🟡 中（マルチテナント環境では高）

---

## 📋 エグゼクティブサマリー

### 概要

現在テナントごとに**Managed OpenSearch Domain**を稼働させている構成を**OpenSearch Serverless Collection**に移行することで、小規模テナントのコスト削減と運用負荷の軽減を実現します。

### 主要メリット

| 項目 | 現状（Managed） | 移行後（Serverless） | 改善度 |
|------|--------------|-------------------|--------|
| **最小コスト** | $182/月/テナント | $86/月/テナント（小規模） | 💰 53%削減 |
| **スケーリング** | 手動、時間かかる | 自動、即座 | ⚡ 大幅向上 |
| **管理負荷** | パッチ、バックアップ必要 | フルマネージド | ✅ ゼロ |
| **最小構成** | 2ノード必須 | 使用量ベース | 📉 柔軟 |

### 適用判断

| テナント規模 | 月間クエリ数 | 推奨 | 理由 |
|------------|------------|------|------|
| **小規模** | < 1,000 | ✅ Serverless | 50%以上のコスト削減 |
| **中規模** | 1,000〜10,000 | ✅ Serverless | 管理負荷削減 |
| **大規模** | 10,000〜50,000 | ⚖️ 要検討 | コストがほぼ同等 |
| **超大規模** | > 50,000 | ❌ Managed維持 | Managedが安い |

---

## 目次

1. [現状分析](#現状分析)
2. [OpenSearch Serverlessアーキテクチャ](#opensearch-serverlessアーキテクチャ)
3. [CDK実装ガイド](#cdk実装ガイド)
4. [データ移行戦略](#データ移行戦略)
5. [コスト詳細分析](#コスト詳細分析)
6. [移行手順](#移行手順)
7. [リスク評価](#リスク評価)

---

## 現状分析

### 現在のManaged OpenSearch構成

**場所:** `packages/cdk/lib/stacks/tenant/tenant-opensearch-stack.ts:152-183`

```typescript
this.domain = new opensearch.Domain(this, 'OpenSearchDomain', {
  version: opensearch.EngineVersion.OPENSEARCH_2_19,
  domainName: `${environment}-${tenantId}-opensearch`,

  // ❌ 固定インスタンス（小規模でもこのサイズ）
  capacity: {
    dataNodeInstanceType: 'm6g.large.search',  // 2vCPU, 8GB RAM
    dataNodes: 2,                               // 最小2ノード（HA構成）
    multiAzWithStandbyEnabled: false,
  },

  // ❌ 固定EBSストレージ
  ebs: {
    enabled: true,
    volumeSize: 100,  // GB
    volumeType: ec2.EbsDeviceVolumeType.GP3,
  },

  // ✓ 可用性設定
  zoneAwareness: {
    enabled: true,
    availabilityZoneCount: 2,
  },

  // ✓ セキュリティ設定
  encryptionAtRest: { enabled: true },
  nodeToNodeEncryption: true,

  // ❌ 管理負荷
  automatedSnapshotStartHour: 0,  // 手動スナップショット設定
});
```

### コスト構造（小規模テナント）

```
データノード: m6g.large.search × 2
  $0.112/時間 × 2 × 720時間/月 = $161.28/月

EBSストレージ: gp3 100GB × 2
  $0.08/GB/月 × 200GB = $16.00/月

データ転送: 約 $5.00/月

合計: $182.28/月/テナント
年間: $2,187/テナント

10テナント: $21,870/年
```

### 問題点

1. ✗ **過剰プロビジョニング**: 小規模テナント（1,000クエリ/月）でも$182/月
2. ✗ **固定コスト**: 使用量に関係なく一定のコスト
3. ✗ **管理負荷**: パッチ適用、スナップショット、スケーリング
4. ✗ **スケーリング遅延**: インスタンス追加に10〜30分

---

## OpenSearch Serverlessアーキテクチャ

### Serverless Collection概要

OpenSearch Serverlessは**使用量ベース課金**のフルマネージドサービスです。

**主要概念:**
- **Collection**: 論理的なOpenSearch環境（Domainに相当）
- **OCU (OpenSearch Compute Units)**: コンピュート単位（0.5 OCU〜）
- **自動スケーリング**: クエリ負荷に応じて自動拡張

### アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────┐
│                    テナント別 Collection                     │
│                                                             │
│  Tenant-1:                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Collection: prod-tenant-1-collection                │   │
│  │ - Type: SEARCH                                       │   │
│  │ - OCU: 0.5〜10 (自動スケーリング)                   │   │
│  │ - インデックス: documents, embeddings               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Tenant-2:                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Collection: prod-tenant-2-collection                │   │
│  │ - Type: SEARCH                                       │   │
│  │ - OCU: 0.5〜10 (自動スケーリング)                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                      ▲
                      │
        ┌─────────────┴─────────────┐
        │   VPC Endpoint (Private)  │
        │   - Security Policy       │
        │   - Network Policy        │
        └─────────────┬─────────────┘
                      │
        ┌─────────────▼─────────────┐
        │   Bedrock Knowledge Base  │
        │   Lambda Functions        │
        └───────────────────────────┘
```

### セキュリティモデル

**3種類のポリシー:**

1. **Encryption Policy**: 暗号化設定
2. **Network Policy**: アクセス制御（VPC、パブリック）
3. **Data Access Policy**: IAM権限

---

## CDK実装ガイド

### 新しいConstruct作成

**新規ファイル:** `packages/cdk/lib/construct/opensearch-serverless.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface OpenSearchServerlessProps {
  readonly tenantId: string;
  readonly environment: string;
  readonly vpc: ec2.IVpc;
}

export class OpenSearchServerless extends Construct {
  public readonly collection: opensearchserverless.CfnCollection;
  public readonly collectionEndpoint: string;
  public readonly collectionArn: string;

  constructor(scope: Construct, id: string, props: OpenSearchServerlessProps) {
    super(scope, id);

    const { tenantId, environment, vpc } = props;
    const collectionName = `${environment}-${tenantId}-collection`;

    // 1. Encryption Policy（暗号化）
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(
      this,
      'EncryptionPolicy',
      {
        name: `${collectionName}-encryption`,
        type: 'encryption',
        policy: JSON.stringify({
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${collectionName}`],
            },
          ],
          AWSOwnedKey: true,  // AWS管理キー使用
        }),
      }
    );

    // 2. Network Policy（VPCエンドポイント経由のみ許可）
    const vpceSecurityGroup = new ec2.SecurityGroup(this, 'VpceSecurityGroup', {
      vpc: vpc,
      description: `Security group for OpenSearch Serverless VPCE (${tenantId})`,
      allowAllOutbound: true,
    });

    // VPC内からのみアクセス許可
    vpceSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS from VPC'
    );

    const vpce = new opensearchserverless.CfnVpcEndpoint(this, 'VpcEndpoint', {
      name: `${collectionName}-vpce`,
      vpcId: vpc.vpcId,
      subnetIds: vpc.privateSubnets.map((subnet) => subnet.subnetId),
      securityGroupIds: [vpceSecurityGroup.securityGroupId],
    });

    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(
      this,
      'NetworkPolicy',
      {
        name: `${collectionName}-network`,
        type: 'network',
        policy: JSON.stringify([
          {
            Rules: [
              {
                ResourceType: 'collection',
                Resource: [`collection/${collectionName}`],
              },
            ],
            AllowFromPublic: false,  // パブリックアクセス不可
            SourceVPCEs: [vpce.attrId],  // VPCエンドポイント経由のみ
          },
        ]),
      }
    );

    // 3. Collection作成
    this.collection = new opensearchserverless.CfnCollection(this, 'Collection', {
      name: collectionName,
      type: 'SEARCH',  // or 'TIMESERIES' for time-series data
      description: `OpenSearch Serverless collection for tenant ${tenantId}`,
    });

    // 依存関係設定
    this.collection.addDependency(encryptionPolicy);
    this.collection.addDependency(networkPolicy);

    // 4. Data Access Policy（IAMベース）
    const dataAccessPolicy = new opensearchserverless.CfnAccessPolicy(
      this,
      'DataAccessPolicy',
      {
        name: `${collectionName}-access`,
        type: 'data',
        policy: JSON.stringify([
          {
            Rules: [
              {
                ResourceType: 'collection',
                Resource: [`collection/${collectionName}`],
                Permission: [
                  'aoss:CreateCollectionItems',
                  'aoss:UpdateCollectionItems',
                  'aoss:DescribeCollectionItems',
                ],
              },
              {
                ResourceType: 'index',
                Resource: [`index/${collectionName}/*`],
                Permission: [
                  'aoss:CreateIndex',
                  'aoss:UpdateIndex',
                  'aoss:DescribeIndex',
                  'aoss:ReadDocument',
                  'aoss:WriteDocument',
                ],
              },
            ],
            Principal: [
              // Bedrock Knowledge Baseロール
              'arn:aws:iam::*:role/service-role/AmazonBedrockExecutionRoleForKnowledgeBase*',
            ],
          },
        ]),
      }
    );

    this.collectionEndpoint = this.collection.attrCollectionEndpoint;
    this.collectionArn = this.collection.attrArn;

    // CloudFormation Outputs
    new cdk.CfnOutput(this, 'CollectionEndpoint', {
      value: this.collectionEndpoint,
      description: `OpenSearch Serverless endpoint for tenant ${tenantId}`,
    });

    new cdk.CfnOutput(this, 'CollectionArn', {
      value: this.collectionArn,
      description: `OpenSearch Serverless ARN for tenant ${tenantId}`,
    });
  }

  /**
   * Grant read/write permissions to a principal
   */
  public grantReadWrite(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: [
        'aoss:APIAccessAll',
        'aoss:DashboardsAccessAll',
      ],
      resourceArns: [this.collectionArn],
    });
  }
}
```

### スタックへの統合

**修正ファイル:** `packages/cdk/lib/stacks/tenant/tenant-opensearch-stack.ts`

```typescript
import { OpenSearchServerless } from '../../construct/opensearch-serverless';

// フィーチャーフラグで切り替え
const useServerless = props.useServerless ?? false;

if (useServerless) {
  // Serverless Collection
  const serverless = new OpenSearchServerless(this, 'ServerlessCollection', {
    tenantId: props.tenantId,
    environment: props.environment,
    vpc: props.vpc,
  });

  this.domainEndpoint = serverless.collectionEndpoint;
  this.domainArn = serverless.collectionArn;
} else {
  // Managed Domain（既存コード）
  this.domain = new opensearch.Domain(this, 'OpenSearchDomain', {
    // ... 既存の設定 ...
  });

  this.domainEndpoint = this.domain.domainEndpoint;
  this.domainArn = this.domain.domainArn;
}
```

---

## データ移行戦略

### 移行方法

#### 方法1: スナップショット/リストア（推奨）

```bash
# 1. Managed Domainのスナップショット作成
aws opensearch create-snapshot \
  --domain-name prod-tenant-1-opensearch \
  --repository my-repository \
  --snapshot snapshot-$(date +%Y%m%d)

# 2. S3にエクスポート
aws s3 sync s3://snapshot-bucket/... s3://migration-bucket/tenant-1/

# 3. Serverless Collectionにインポート
# OpenSearch APIを使用
curl -X POST "https://${COLLECTION_ENDPOINT}/_snapshot/my-repo/snapshot-20251031/_restore" \
  -H "Content-Type: application/json" \
  -d '{
    "indices": "*",
    "include_global_state": false
  }' \
  --aws-sigv4 "aws:amz:us-east-1:aoss"
```

#### 方法2: 再インデックス

```python
# Lambda関数またはスクリプト
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import boto3

# Managed Domain接続
managed_client = OpenSearch(
    hosts=[{'host': managed_endpoint, 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection
)

# Serverless Collection接続
serverless_client = OpenSearch(
    hosts=[{'host': serverless_endpoint, 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    http_compress=True  # Serverless推奨
)

# インデックスマッピング取得
mappings = managed_client.indices.get_mapping(index='documents')

# Serverlessにインデックス作成
serverless_client.indices.create(
    index='documents',
    body={'mappings': mappings['documents']['mappings']}
)

# データコピー（Scroll API）
scroll = managed_client.search(
    index='documents',
    scroll='2m',
    size=1000,
    body={'query': {'match_all': {}}}
)

while len(scroll['hits']['hits']) > 0:
    # バルクインデックス
    actions = []
    for hit in scroll['hits']['hits']:
        actions.append({
            'index': {
                '_index': 'documents',
                '_id': hit['_id']
            }
        })
        actions.append(hit['_source'])

    serverless_client.bulk(body=actions)

    # 次のバッチ
    scroll = managed_client.scroll(scroll_id=scroll['_scroll_id'], scroll='2m')
```

---

## コスト詳細分析

### テナント規模別コスト比較

#### 小規模テナント（1,000クエリ/月、1GB インデックス）

**Managed Domain:**
```
m6g.large.search × 2: $161.28/月
EBS 200GB: $16.00/月
データ転送: $5.00/月
合計: $182.28/月
```

**Serverless Collection:**
```
OCU: 0.5 OCU × 720時間 × $0.24 = $86.40/月
ストレージ: 1GB × $0.024 = $0.024/月
合計: $86.42/月

削減額: $95.86/月 → $1,150/年 (53%削減)
```

#### 中規模テナント（10,000クエリ/月、10GB インデックス）

**Managed Domain:**
```
同上: $182.28/月
```

**Serverless Collection:**
```
OCU: 1 OCU × 720時間 × $0.24 = $172.80/月
ストレージ: 10GB × $0.024 = $0.24/月
合計: $173.04/月

削減額: $9.24/月 → $111/年 (5%削減)
```

#### 大規模テナント（50,000クエリ/月、50GB インデックス）

**Managed Domain:**
```
m6g.large.search × 2: $161.28/月
EBS 200GB: $16.00/月
データ転送: $10.00/月
合計: $187.28/月
```

**Serverless Collection:**
```
OCU: 2 OCU × 720時間 × $0.24 = $345.60/月
ストレージ: 50GB × $0.024 = $1.20/月
合計: $346.80/月

増加額: $159.52/月 → $1,914/年 (85%増)
```

### 損益分岐点

**月間クエリ数による損益分岐点:**
```
約15,000〜20,000クエリ/月でコストが同等
```

**推奨:**
- < 15,000クエリ/月: Serverless推奨
- 15,000〜20,000クエリ/月: どちらでも可
- > 20,000クエリ/月: Managed推奨

---

## 移行手順

### フェーズ1: パイロットテナント移行（2週間）

**対象:** 最小規模テナント1つ

1. ✅ Serverless Collection作成（開発環境）
2. ✅ インデックスマッピング検証
3. ✅ データ移行スクリプト実行
4. ✅ Bedrock Knowledge Base接続テスト
5. ✅ クエリパフォーマンステスト
6. ✅ 本番環境で移行実施
7. ✅ 1週間監視

**成功基準:**
- クエリ成功率 > 99.9%
- レスポンスタイム < Managed比1.5倍
- コスト削減 > 30%

### フェーズ2: 小規模テナント移行（4週間）

**対象:** < 5,000クエリ/月のテナント

1. ✅ 週に2〜3テナントずつ移行
2. ✅ 移行後48時間監視
3. ✅ 問題なければ次のテナント

### フェーズ3: 選択的移行（継続）

**対象:** 中規模テナント（要検討）

- コスト分析後、テナントごとに判断
- 管理負荷削減のメリットも考慮

---

## リスク評価

| リスク | 確率 | 影響度 | 軽減策 | 残存リスク |
|-------|------|--------|--------|----------|
| **データ移行失敗** | 中 | 高 | スナップショット、検証スクリプト | 低 |
| **クエリ性能劣化** | 低 | 中 | 事前ベンチマーク、段階的移行 | 低 |
| **コスト超過** | 中 | 中 | OCU上限設定、モニタリング | 中 |
| **API互換性問題** | 低 | 中 | マッピング検証、テスト | 低 |

---

## 次のステップ

### 1週間以内
1. **パイロットテナント選定**: 最小規模テナント
2. **開発環境でServerless Collection作成**
3. **データ移行スクリプト作成**

### 2週間以内
1. **パイロット移行実施**
2. **コスト・パフォーマンス検証**
3. **移行判定**

### 1ヶ月以内
1. **小規模テナント段階的移行**
2. **コスト削減効果測定**

---

## 参考リソース

- [OpenSearch Serverless Documentation](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless.html)
- [Serverless Pricing](https://aws.amazon.com/opensearch-service/pricing/)
- [Migration Guide](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-migration.html)

---

**変更履歴:**

| 日付 | 変更内容 | 作成者 |
|------|---------|--------|
| 2025-10-31 | 初版作成 | Claude Code Analysis |
