# CI/CD Setup Guide

This guide explains how to set up CI/CD for this project using GitHub Actions with OIDC authentication and secure CDK configuration management.

## Architecture Overview

The CI/CD pipeline uses:
- **GitHub Actions** for workflow orchestration
- **Dagger** for containerized, reproducible builds
- **AWS OIDC** for secure, temporary credentials (no long-lived access keys)
- **GitHub Secrets** for base64-encoded CDK configuration

## Prerequisites

- AWS Account with appropriate permissions
- GitHub repository with Actions enabled
- GitHub CLI (`gh`) installed locally
- `jq` for JSON validation (optional but recommended)

## Setup Steps

### 1. AWS OIDC Configuration

#### 1.1 Create OIDC Identity Provider

```bash
# Create OIDC provider (one-time setup per AWS account)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

#### 1.2 Create IAM Role

Create a trust policy file `github-oidc-trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_ORG/YOUR_REPO:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

**Important:** Replace:
- `YOUR_ACCOUNT_ID` with your AWS account ID
- `YOUR_GITHUB_ORG/YOUR_REPO` with your GitHub repository path

Create the IAM role:

```bash
# Create role
aws iam create-role \
  --role-name github-actions-role \
  --assume-role-policy-document file://github-oidc-trust-policy.json

# Attach permissions (adjust as needed - this example uses full admin)
aws iam attach-role-policy \
  --role-name github-actions-role \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

**Security Note:** In production, use least-privilege permissions instead of `AdministratorAccess`. Create a custom policy with only CDK deployment permissions.

#### 1.3 Get Role ARN

```bash
aws iam get-role --role-name github-actions-role --query 'Role.Arn' --output text
```

Save this ARN for the next step.

### 2. GitHub Configuration

#### 2.1 Set GitHub Variables

```bash
# Set AWS region
gh variable set AWS_DEFAULT_REGION --body "us-east-1"

# Set IAM role ARN (from step 1.3)
gh variable set AWS_DEPLOY_ROLE_ARN --body "arn:aws:iam::YOUR_ACCOUNT_ID:role/github-actions-role"
```

#### 2.2 Prepare CDK Configuration

Copy the example configuration:

```bash
cp cdk.json.example packages/cdk/cdk.json
```

Edit `packages/cdk/cdk.json` with your configuration:

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/generative-ai-use-cases.ts",
  "context": {
    "env": "prod",
    "modelRegion": "us-east-1",
    "ragEnabled": true,
    "selfSignUpEnabled": false,
    ...
  }
}
```

See [DEPLOY_OPTION.md](./DEPLOY_OPTION.md) for all available configuration options.

#### 2.3 CDK設定をGitHub Secretsにアップロード

提供されているスクリプトを使用します：

```bash
./scripts/upload-config.sh --type cdk
```

または手動で：

```bash
# エンコードしてアップロード
base64 -w 0 < packages/cdk/cdk.json | gh secret set CDK_CONFIG_BASE64
```

**アップロードスクリプトのオプション：**

```bash
# ヘルプを表示
./scripts/upload-config.sh --help

# カスタムパスからアップロード
./scripts/upload-config.sh --type cdk /path/to/custom-cdk.json

# アップロードせずにbase64を出力
./scripts/upload-config.sh --type cdk --output

# カスタムシークレット名を使用
./scripts/upload-config.sh --type cdk --secret-name MY_CDK_CONFIG
```

#### 2.4 LiteLLM Proxy設定のアップロード（オプション）

**注意：** このステップは、`cdk.json`で`litellmProxyEnabled: true`を設定している場合にのみ必要です。

LiteLLM Proxyは、複数のAIモデルプロバイダー（AWS Bedrock、OpenAI、Azure OpenAI、Google Vertex AIなど）への統一されたAPIインターフェースを提供します。

##### 2.4.1 config.yamlの準備

`packages/cdk/litellm-proxy-server/config.yaml`ファイルを作成し、モデル設定とAPIキーを含めます：

```yaml
model_list:
  # AWS Bedrock（IAMロールを使用、APIキー不要）
  - model_name: claude-3-5-sonnet
    litellm_params:
      model: bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0
      aws_region_name: us-east-1

  # OpenAI（APIキーが必要）
  - model_name: gpt-4
    litellm_params:
      model: gpt-4
      api_key: sk-your-openai-api-key-here

general_settings:
  master_key: sk-litellm-master-key  # 本番環境では強力なキーに変更してください

litellm_settings:
  drop_params: true
  success_callback: []
```

詳細な設定オプションについては、`packages/cdk/litellm-proxy-server/README.md`を参照してください。

##### 2.4.2 LiteLLM設定のアップロード

提供されているスクリプトを使用します：

```bash
./scripts/upload-config.sh --type litellm
```

または手動で：

```bash
# エンコードしてアップロード
base64 -w 0 < packages/cdk/litellm-proxy-server/config.yaml | gh secret set LITELLM_CONFIG_BASE64
```

**セキュリティ上の注意：**
- `config.yaml`にはAPIキーやマスターキーなどの機密情報が含まれています
- このファイルは絶対にバージョン管理にコミットしないでください（`.gitignore`に含まれています）
- 本番環境では強力でユニークなマスターキーを使用してください
- APIキーを定期的にローテーションしてください

### 3. セットアップの確認

必要なすべてのシークレットと変数が設定されていることを確認します：

```bash
# 変数のリスト
gh variable list

# 以下が表示されるはずです：
# AWS_DEFAULT_REGION    us-east-1
# AWS_DEPLOY_ROLE_ARN   arn:aws:iam::...

# シークレットのリスト
gh secret list

# 以下が表示されるはずです：
# CDK_CONFIG_BASE64     Updated YYYY-MM-DD
# LITELLM_CONFIG_BASE64 Updated YYYY-MM-DD  # LiteLLMを有効にしている場合のみ
```

### 4. Test Deployment

#### 4.1 Local Testing (Optional)

Test the Dagger pipeline locally:

```bash
# CI stage only
cd dagger
npm run ci

# Full deployment (requires AWS credentials and CDK_CONFIG_BASE64)
export CDK_CONFIG_BASE64=$(base64 -w 0 < ../packages/cdk/cdk.json)
npm run deploy
```

#### 4.2 Trigger GitHub Actions

Push to main branch or create a tag:

```bash
# Push to main (triggers CI + deploy)
git push origin main

# Create and push tag (triggers CI + deploy)
git tag v1.0.0
git push origin v1.0.0

# Pull request (CI only, no deploy)
git checkout -b feature/test
git push origin feature/test
# Create PR via gh pr create
```

## ワークフローの動作

### プルリクエスト時
- ✅ 品質チェックの実行（lint、型チェック）
- ✅ すべてのパッケージのビルド
- ❌ デプロイなし

### main ブランチへのプッシュ時
- ✅ 品質チェックの実行
- ✅ すべてのパッケージのビルド
- ✅ OIDCを使用したAWSロールの引き受け
- ✅ GitHub Secretsからcdk.jsonのデコード
- ✅ `litellmProxyEnabled`フラグの抽出
- ✅ LiteLLM config.yamlのデコード（有効な場合）
- ✅ AWSへのデプロイ

### タグプッシュ時（v*）
- main ブランチへのプッシュと同じ

## 設定の更新

### CDK設定の更新

デプロイ設定を変更する必要がある場合：

1. ローカルの`packages/cdk/cdk.json`を編集
2. GitHub Secretsにアップロード：
   ```bash
   ./scripts/upload-config.sh --type cdk
   ```
3. プッシュしてデプロイをトリガー：
   ```bash
   git push origin main
   ```

### LiteLLM設定の更新

LiteLLMモデル設定やAPIキーを変更する必要がある場合：

1. ローカルの`packages/cdk/litellm-proxy-server/config.yaml`を編集
2. GitHub Secretsにアップロード：
   ```bash
   ./scripts/upload-config.sh --type litellm
   ```
3. プッシュしてデプロイをトリガー：
   ```bash
   git push origin main
   ```

**注意：** LiteLLMを有効/無効にする場合は、`cdk.json`の`litellmProxyEnabled`フラグも更新してください。

### AWS認証情報/ロールの更新

IAMロールを変更する必要がある場合：

1. AWS IAMでロールを更新
2. GitHub変数を更新：
   ```bash
   gh variable set AWS_DEPLOY_ROLE_ARN --body "arn:aws:iam::ACCOUNT:role/NewRole"
   ```

## Security Best Practices

### ✅ DO

- Use OIDC for authentication (no long-lived credentials)
- Restrict IAM role permissions to minimum required
- Limit role assumption to specific branches/tags
- Review `cdk.json` before uploading
- Use separate configurations for dev/staging/prod
- Rotate credentials regularly (OIDC handles this automatically)

### ❌ DON'T

- Store AWS credentials in GitHub Secrets
- Use `AdministratorAccess` in production
- Commit `packages/cdk/cdk.json` to version control (it's gitignored)
- Share base64-encoded secrets in chat/email
- Allow all branches to deploy

## トラブルシューティング

### "CDK_CONFIG_BASE64 environment variable not found"

**原因:** GitHubにシークレットが設定されていない

**解決方法:**
```bash
./scripts/upload-config.sh --type cdk
```

### "LITELLM_CONFIG_BASE64 secret not found but litellmProxyEnabled is true"

**原因:** LiteLLMが有効だが、config.yamlシークレットがアップロードされていない

**解決方法:**
```bash
./scripts/upload-config.sh --type litellm
```

または、LiteLLMを使用しない場合は`cdk.json`で無効にします：
```json
{
  "context": {
    "litellmProxyEnabled": false
  }
}
```

### "Docker build failed: COPY config.yaml"

**原因:** LiteLLMが有効だが、config.yamlが見つからない

**解決方法:**
1. `LITELLM_CONFIG_BASE64`シークレットが設定されていることを確認
2. ワークフローログでLiteLLM configのデコードステップが実行されたか確認
3. 必要に応じて、config.yamlを再アップロード：
   ```bash
   ./scripts/upload-config.sh --type litellm
   ```

### "Error: Could not assume role"

**原因:** OIDCトラストポリシーの不一致

**解決方法:** トラストポリシーがリポジトリを許可していることを確認：
```bash
aws iam get-role --role-name github-actions-role --query 'Role.AssumeRolePolicyDocument'
```

### "CDK deploy failed: Invalid context"

**原因:** 無効な`cdk.json`設定

**解決方法:** ローカルでJSONを検証：
```bash
jq empty packages/cdk/cdk.json
```

### "Access Denied" during deployment

**原因:** IAMロールに必要な権限がない

**解決方法:** IAMロールに必要なポリシーを追加：
```bash
aws iam attach-role-policy \
  --role-name github-actions-role \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
```

### LiteLLM config.yamlの検証エラー

**原因:** 無効なYAML構文またはモデル設定

**解決方法:** YAMLを検証：
```bash
# yqを使用（インストールされている場合）
yq eval packages/cdk/litellm-proxy-server/config.yaml

# またはPython
python3 -c "import yaml; yaml.safe_load(open('packages/cdk/litellm-proxy-server/config.yaml'))"
```

## アーキテクチャ図

```
┌──────────────────────────────────────────────────────────────────┐
│ GitHub Actions ワークフロー                                      │
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐                        │
│  │ Checkout     │─────▶│ Setup Node   │                        │
│  └──────────────┘      └──────────────┘                        │
│                              │                                   │
│                              ▼                                   │
│                    ┌──────────────────┐                         │
│                    │ Configure AWS    │◀────OIDC Token          │
│                    │ (OIDC)          │                         │
│                    └──────────────────┘                         │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────┐    ┌──────────────────┐                        │
│  │ Decode     │───▶│ Extract LiteLLM  │                        │
│  │ cdk.json   │    │ Enable Flag      │                        │
│  └────────────┘    └──────────────────┘                        │
│                              │                                   │
│                              ▼                                   │
│                    ┌──────────────────┐                         │
│                    │ Decode config.   │ (条件付き:              │
│                    │ yaml (LiteLLM)   │  litellmProxyEnabled)   │
│                    └──────────────────┘                         │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────┐              │
│  │ CDKパイプライン                              │              │
│  │                                              │              │
│  │  ┌─────────────┐    ┌─────────────┐        │              │
│  │  │ Bootstrap   │───▶│ Deploy CDK  │        │              │
│  │  │ CDK         │    │ Stacks      │        │              │
│  │  └─────────────┘    └─────────────┘        │              │
│  │                            │                 │              │
│  │                            ▼                 │              │
│  │                  ┌──────────────────┐       │              │
│  │                  │ Docker Image     │       │              │
│  │                  │ Build (LiteLLM)  │       │              │
│  │                  └──────────────────┘       │              │
│  └──────────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │ AWS CloudFormation│
              │ Stacks            │
              └──────────────────┘
```

## Additional Resources

- [AWS OIDC Documentation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Dagger Documentation](https://docs.dagger.io/)

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review GitHub Actions logs
3. Check AWS CloudWatch logs
4. Open an issue in the repository