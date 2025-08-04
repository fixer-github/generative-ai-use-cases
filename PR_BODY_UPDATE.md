## 概要
AWS Key Management Service (KMS) V1を使用してLiteLLMのAPIキーをセキュアに管理する機能を実装しました。PR#20で追加されたlitellm-proxy-serverと統合し、動的な設定管理を実現しています。

## 主な変更内容

### 🔐 セキュリティ機能
- **KMSによる暗号化**: FIPS 140-2検証済みの暗号化でAPIキーを保護
- **動的設定生成**: 静的な設定ファイルを排除し、実行時に設定を生成
- **自動キーローテーション**: 90日間隔でのAPIキー自動更新
- **監査ログ**: CloudTrailによる全操作の記録

### 🏗️ アーキテクチャ
```
cdk.json → KMS → Secrets Manager → Config Loader → LiteLLM Proxy Server
```

### 🔄 PR#20との統合
- **動的設定ローダー**: `config_loader.py`がKMS/Secrets Managerから設定を取得
- **環境変数による制御**: `USE_DYNAMIC_CONFIG=true`でKMS統合を有効化
- **既存proxy serverの拡張**: PR#20のDockerコンテナにKMS機能を追加

### 📁 新規・更新ファイル
- `packages/cdk/lib/construct/litellm-kms.ts` - KMSコンストラクト
- `packages/cdk/lambda/utils/litellmKmsClient.ts` - KMSクライアントユーティリティ
- `packages/cdk/litellm-proxy-server/config_loader.py` - 動的設定ローダー（新規）
- `packages/cdk/litellm-proxy-server/startup.py` - KMS対応に更新
- `packages/cdk/litellm-proxy-server/Dockerfile` - boto3とpyyamlを追加
- `packages/cdk/litellm-proxy-server/README.md` - KMS統合ドキュメント追加
- `packages/cdk/lib/construct/litellm-proxy-server.ts` - KMS権限を追加
- `packages/cdk/lib/stacks/common/generative-ai-use-cases-stack.ts` - KMS統合
- `packages/types/src/litellm.d.ts` - TypeScript型定義
- `docs/LITELLM_KMS_SETUP.md` - 英語版セットアップガイド
- `docs/ja/LITELLM_KMS_SETUP.md` - 日本語版セットアップガイド

### 🔧 主な機能
- ✅ 複数LLMプロバイダー対応（OpenAI、Anthropic、Bedrock等）
- ✅ 環境変数を使わないセキュアなAPIキー管理
- ✅ キャッシュによるパフォーマンス最適化（KMS APIコール削減）
- ✅ バーチャルキーによる一時的なアクセス管理
- ✅ CloudWatchアラームによる異常検知
- ✅ PR#20のproxy serverとのシームレスな統合

## 使用方法

### 1. cdk.jsonで有効化
```json
{
  "context": {
    "litellmProxyEnabled": true,  // PR#20のproxy serverを有効化
    "litellm": {
      "enabled": true,           // KMS統合を有効化
      "providers": {
        "openai": { "enabled": true },
        "anthropic": { "enabled": true }
      }
    }
  }
}
```

### 2. デプロイ
```bash
npm run cdk:deploy
```

### 3. APIキーを保存（プレーンテキストのみ）
```bash
aws secretsmanager put-secret-value \
  --secret-id litellm/openai/api-key \
  --secret-string "sk-proj-..."  # JSONではなくプレーンキー
```

## 動作の仕組み

1. **起動時**: LiteLLM proxy serverが`USE_DYNAMIC_CONFIG`環境変数をチェック
2. **KMS有効時**: `config_loader.py`がSecrets ManagerからAPIキーを取得
3. **設定生成**: 復号化されたキーで`config.yaml`を動的生成
4. **proxy server起動**: 生成された設定でLiteLLMが起動

## セキュリティ上の利点

| 従来の方法 | KMS統合 |
|-----------|---------|
| 環境変数にAPIキー | Secrets Managerで暗号化 |
| CloudFormationで露出 | 暗号化された参照のみ |
| 手動ローテーション | 自動ローテーション |
| 変更時に再デプロイ | 再デプロイ不要 |

## 月額コスト
約$1.30（KMSキー + API呼び出し）

## テスト状況
- [x] TypeScriptコンパイル成功
- [x] ESLintチェック通過
- [x] PR#20との統合確認
- [x] rebase完了
- [ ] 統合テスト（デプロイ後に実施予定）

## 関連PR
- #20 - litellm-proxy-serverの実装（このPRの基盤）

## 関連ドキュメント
- [英語版セットアップガイド](docs/LITELLM_KMS_SETUP.md)
- [日本語版セットアップガイド](docs/ja/LITELLM_KMS_SETUP.md)
- [LiteLLM Proxy Server README](packages/cdk/litellm-proxy-server/README.md)
- [LiteLLM公式ドキュメント](https://docs.litellm.ai/docs/secret)