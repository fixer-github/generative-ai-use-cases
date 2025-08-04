# LiteLLM KMSシークレット管理セットアップガイド

このガイドでは、Generative AI Use CasesアプリケーションでAWS Key Management Service (KMS)を使用してLiteLLMのAPIキーを安全に管理する方法を説明します。

## 概要

AWS KMS V1を使用したLiteLLMシークレット管理は以下を提供します：

- APIキーの一元的な暗号化と保存
- 動的な設定生成（静的な設定ファイル不要）
- 自動キーローテーション機能
- マルチプロバイダーサポート（OpenAI、Anthropic、Azure等）
- 一時アクセス用のバーチャルキー生成
- 監査ログとモニタリング
- 設定変更時の再デプロイ不要

## アーキテクチャ

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Lambda関数     │────▶│   AWS KMS       │────▶│ Secrets Manager │
│  (LiteLLM)      │     │   (暗号化)       │     │  (保存)         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                                │
        └───────────────────────────────────────────────┘
                    復号化されたAPIキー
                            │
                            ▼
                ┌─────────────────────┐
                │  設定ジェネレーター   │
                │  (動的YAML生成)      │
                └─────────────────────┘
```

## 前提条件

- AWS CDK v2.x インストール済み
- AWS CLI 設定済み（適切な認証情報付き）
- Node.js 18.x 以降
- TypeScript 5.x 以降

## 設定

### 1. CDKコンテキストでLiteLLMを有効化

`cdk.json`ファイルを更新してLiteLLMを有効にします：

```json
{
  "context": {
    "litellm": {
      "enabled": true,
      "kms": {
        "keyAlias": "alias/litellm-master",
        "enableKeyRotation": true,
        "pendingWindowInDays": 7,
        "enableAuditLog": true,
        "secretRotationDays": 90
      },
      "providers": {
        "openai": {
          "enabled": true,
          "secretKey": "OPENAI_API_KEY",
          "modelPrefix": "openai"
        },
        "anthropic": {
          "enabled": true,
          "secretKey": "ANTHROPIC_API_KEY",
          "modelPrefix": "anthropic"
        },
        "bedrock": {
          "enabled": true,
          "useIAMRole": true,
          "modelPrefix": "bedrock"
        }
      },
      "virtualKeys": {
        "enabled": true,
        "prefix": "litellm_vk_",
        "defaultExpiry": 2592000
      },
      "routing": {
        "strategy": "least-cost",
        "enableFallbacks": true,
        "defaultProvider": "openai"
      }
    }
  }
}
```

### 2. 環境変数 - 設定してはいけないもの

**重要**: KMS統合を使用する場合、以下の環境変数を直接設定してはいけません：

❌ **設定してはいけない環境変数**:

```bash
# APIキー - KMS/Secrets Managerで管理されます
export OPENAI_API_KEY="sk-..."           # ❌ 直接設定しない
export ANTHROPIC_API_KEY="sk-ant-..."    # ❌ 直接設定しない
export AZURE_API_KEY="..."               # ❌ 直接設定しない
export GOOGLE_API_KEY="..."              # ❌ 直接設定しない

# LiteLLM設定 - 自動設定されます
export LITELLM_MASTER_KEY="..."          # ❌ 自動生成
export LITELLM_CONFIG_PATH="..."         # ❌ 動的生成
export LITELLM_KEY_MANAGEMENT_SYSTEM="..." # ❌ aws_kmsに自動設定
```

✅ **自動的に設定される環境変数**:

```bash
# これらはCDKコンストラクトによって自動的に設定されます：
LITELLM_MASTER_KEY=<encrypted>           # ✅ KMSで暗号化
LITELLM_KEY_MANAGEMENT_SYSTEM=aws_kms    # ✅ 自動設定
KMS_KEY_ID=arn:aws:kms:...              # ✅ CDKデプロイから
LITELLM_CONFIG_SECRET_ARN=arn:aws:...   # ✅ 設定の場所
AWS_REGION_NAME=us-east-1               # ✅ AWS環境から
```

✅ **設定可能なオプション環境変数**:

```bash
# デバッグとログ
export LITELLM_DEBUG=true               # デバッグログを有効化
export LITELLM_LOG_LEVEL=INFO          # ログレベル（DEBUG, INFO, WARN, ERROR）

# キャッシュ設定（デフォルトを使用しない場合）
export LITELLM_CACHE_TTL=7200          # キャッシュTTL（秒）（デフォルト: 3600）
export LITELLM_CACHE_BACKEND=redis     # キャッシュバックエンド（デフォルト: in-memory）
```

### 3. よくある間違いを避ける

#### ❌ **間違い: Lambda環境変数にAPIキーを設定**

```typescript
// これはやってはいけません
new lambda.Function(this, 'MyFunction', {
  environment: {
    OPENAI_API_KEY: 'sk-...', // ❌ CloudFormationで露出
    ANTHROPIC_API_KEY: 'sk-ant-...', // ❌ コンソールで表示
  },
});
```

#### ✅ **正解: LiteLLM KMSコンストラクトを使用**

```typescript
// 代わりにこうします
const litellmKms = new LiteLLMKms(this, 'LiteLLM', {
  kmsKey: kmsStack.kmsKey,
  providers: {
    /* 設定 */
  },
});

litellmKms.grantRead(myFunction); // ✅ セキュアなアクセス
```

#### ❌ **間違い: 設定ファイルパスをハードコード**

```bash
# これはやってはいけません
export LITELLM_CONFIG_PATH="/path/to/config.yaml"  # ❌ 静的ファイル
```

#### ✅ **正解: 動的設定を使用**

```typescript
// 設定は動的に生成されます
const config = await LiteLLMConfigGenerator.generateProxyConfig();
```

### 4. AWS Secrets ManagerにAPIキーを保存

デプロイ後、AWS Secrets ManagerにAPIキーを保存します：

**重要**: プレーンなAPIキー文字列のみを保存し、JSONやその他の形式は使用しません。

```bash
# OpenAI APIキーを保存（キーのみ、JSONラッパーなし）
aws secretsmanager put-secret-value \
  --secret-id litellm/openai/api-key \
  --secret-string "sk-proj-abcd1234..."  # ✅ プレーンキーのみ

# Anthropic APIキーを保存
aws secretsmanager put-secret-value \
  --secret-id litellm/anthropic/api-key \
  --secret-string "sk-ant-api03-abcd1234..."  # ✅ プレーンキーのみ

# Azure OpenAI（有効な場合）
aws secretsmanager put-secret-value \
  --secret-id litellm/azure/api-key \
  --secret-string "1234567890abcdef..."  # ✅ プレーンキーのみ

# ❌ このようなJSON形式で保存しないでください:
# --secret-string '{"api_key": "sk-..."}' # 間違った形式！
```

**注**: AWS Secrets Managerは、作成したKMSキーを使用してこれらのキーを自動的に暗号化します。

### 5. スタックのデプロイ

LiteLLM KMSスタックをデプロイします：

```bash
npm run cdk:deploy
```

## 動的設定生成

従来の静的YAMLファイルが必要なアプローチとは異なり、私たちの実装はLiteLLM設定を動的に生成します：

### 設定生成エンドポイント

```typescript
// GET /litellm/config?format=yaml
// 動的に生成されたYAML設定を返します

// GET /litellm/config?format=json
// JSON設定を返します
```

このアプローチの利点：

- ✅ 維持する静的設定ファイルがない
- ✅ プロバイダー変更時の再デプロイ不要
- ✅ 設定が常にシークレットと同期
- ✅ 単一の信頼できる情報源（cdk.json）

## Lambda関数での使用方法

### 基本的な使い方

```typescript
import { getLiteLLMKmsClient } from './utils/litellmKmsClient';

export const handler = async (event: any) => {
  // LiteLLM KMSクライアントを初期化
  const litellmClient = await getLiteLLMKmsClient();

  // プロバイダーの復号化されたAPIキーを取得
  const openaiKey = await litellmClient.getProviderApiKey('openai');

  // 完全な設定を取得
  const config = await litellmClient.getConfiguration();

  // LiteLLMプロキシ用のモデル設定を構築
  const models = await litellmClient.buildModelConfig();

  // LiteLLMで使用
  // ... あなたのLiteLLMコードをここに
};
```

### Lambdaに権限を付与

CDKスタックで：

```typescript
import { LiteLLMKms } from './construct/litellm-kms';

// LiteLLM KMSコンストラクトを作成
const litellmKms = new LiteLLMKms(this, 'LiteLLMKms', {
  kmsKey: kmsStack.kmsKey,
  providers: {
    openai: { enabled: true, secretKey: 'OPENAI_API_KEY' },
    anthropic: { enabled: true, secretKey: 'ANTHROPIC_API_KEY' },
  },
});

// Lambda関数に読み取り権限を付与
litellmKms.grantRead(yourLambdaFunction);
```

## バーチャルキー

バーチャルキーは、特定の権限を持つLiteLLMへの一時的なアクセスを許可します：

```typescript
// バーチャルキー管理権限を付与
litellmKms.grantVirtualKeyManagement(virtualKeyLambda);

// Lambda関数内で
const litellmClient = await getLiteLLMKmsClient();

// バーチャルキーを作成
const virtualKey = await createVirtualKey({
  userId: 'user123',
  expiresIn: 86400, // 24時間
  models: ['gpt-4', 'claude-3'],
  metadata: {
    department: 'engineering',
    project: 'chatbot',
  },
});
```

## セキュリティ比較

### 従来のアプローチ vs KMSアプローチ

| 側面                       | 従来 (❌)                              | KMS統合 (✅)                              |
| -------------------------- | -------------------------------------- | ----------------------------------------- |
| **APIキーの保存**          | 環境変数や設定ファイル                 | AWS Secrets Managerで暗号化               |
| **キーの可視性**           | CloudFormation、Lambdaコンソールで表示 | 露出なし、暗号化された参照のみ            |
| **キーローテーション**     | 手動プロセス、再デプロイが必要         | 再デプロイなしで自動ローテーション        |
| **アクセス制御**           | Lambda全体へのアクセス                 | キーごとの細かいIAMポリシー               |
| **監査証跡**               | 限定的またはなし                       | 完全なCloudTrailログ                      |
| **設定更新**               | コード変更とデプロイが必要             | Secrets Manager経由で動的更新             |
| **マルチプロバイダーキー** | 複数の環境変数に分散                   | 一元管理                                  |
| **コスト**                 | 無料だが安全でない                     | エンタープライズセキュリティで月額約$1.30 |

## セキュリティベストプラクティス

1. **最小権限アクセス**: Lambda関数に必要な権限のみを付与
2. **キーローテーション**: APIキーの自動ローテーションを有効化（デフォルト：90日）
3. **監査ログ**: すべてのKMS操作をCloudTrailで監視
4. **ネットワーク分離**: Secrets ManagerアクセスにVPCエンドポイントを使用
5. **環境分離**: dev/staging/prodで異なるKMSキーを使用

## モニタリングとアラート

スタックは以下のCloudWatchアラームを自動的に作成します：

- KMS復号化失敗の試行（しきい値：5分間に10回）
- APIコールの高エラー率
- 異常な使用パターン

CloudWatchの`LiteLLM/Proxy`ネームスペースでメトリクスを表示します。

## コスト最適化

1. **キャッシング**: 復号化されたキーを1時間キャッシュしてKMS APIコールを削減
2. **ルーティング戦略**: APIコストを最小化するために`least-cost`ルーティングを設定
3. **フォールバック**: 障害時に代替プロバイダーへのフォールバックを有効化

## トラブルシューティング

### よくある問題

1. **KMSアクセス拒否**

   - Lambda実行ロールに`kms:Decrypt`権限があることを確認
   - KMSキーポリシーがLambdaロールを許可していることを確認

2. **シークレットが見つからない**

   - Secrets Managerにシークレットが存在することを確認
   - シークレット名が設定と一致していることを確認

3. **初期化の失敗**
   - 環境変数が正しく設定されていることを確認
   - 詳細なエラーメッセージはCloudWatchログを確認

### デバッグモード

デバッグログを有効化：

```typescript
process.env.LITELLM_DEBUG = 'true';
```

## APIキーの更新

APIキーを更新する方法：

```bash
# シークレット値を更新
aws secretsmanager update-secret \
  --secret-id litellm/openai/api-key \
  --secret-string "sk-new-api-key"

# 変更はキャッシュ期限後（1時間）に自動的に反映されます
# または、即座に更新を強制するためにLambda関数を再起動します
```

## コンプライアンスと監査

すべてのKMS操作はCloudTrailに記録されます。監査ログを表示するには：

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=alias/litellm-master \
  --max-items 10
```

## サポート

問題や質問がある場合：

- 詳細なエラーメッセージはCloudWatchログを確認
- [LiteLLMドキュメント](https://docs.litellm.ai/)を参照
- プロジェクトリポジトリでissueを作成
