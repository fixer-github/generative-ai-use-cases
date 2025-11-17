# レビュー結果: CDK bin & config

## 担当ファイル
- packages/cdk/bin/generative-ai-use-cases-tenant.ts
- packages/cdk/cdk.context.json
- packages/cdk/cdk.tenant.example.json

## 重大な問題（Critical）

### 1. cdk.context.json に実際のAWSアカウント番号が含まれている（セキュリティリスク）
**ファイル**: packages/cdk/cdk.context.json

**問題内容**:
```json
{
  "availability-zones:account=386357749311:region=us-east-1": [...]
}
```

- 実際のAWSアカウント番号 `386357749311` がハードコードされている
- このファイルは `.gitignore` に含まれておらず、バージョン管理されている
- AWSアカウント情報の漏洩リスクがある

**推奨対応**:
1. cdk.context.json を .gitignore に追加
2. 既にコミットされた場合は、git historyからも削除を検討
3. CDKが自動生成するファイルなので、通常は .gitignore に含めるべき

---

## 警告レベルの問題（Warning）

### 1. 削除されたパラメータが実際に使用されていないか確認が必要
**ファイル**: packages/cdk/bin/generative-ai-use-cases-tenant.ts

**問題内容**:
以下のパラメータが削除されているが、スタック側で使用されていないことの確認が必要:
- `controlPlaneRegion` (TenantStackInput から削除)
- `controlPlaneAccount` (TenantStackInput から削除)
- `tenantsTableName` (TenantStackInput から削除)
- `openSearchIndexName` (TenantStackInput から削除)
- `controlPlane.openSearchIndexName` (TenantConfig interface から削除)

**現状**:
- `create-tenant-stacks.ts` では新しいインターフェースに対応済み
- develop版では `TenantStackInput` に含まれていたが、削除されている
- これらのパラメータを使用するスタックが存在する場合、デプロイエラーが発生する可能性

**推奨対応**:
- 全テナントスタック（特に IAM, OpenSearch関連）でこれらのパラメータが使用されていないことを確認
- もし使用されている場合は、削除前に代替手段を実装する必要がある

### 2. controlPlaneAccount のコンテキスト設定が削除されている
**ファイル**: packages/cdk/bin/generative-ai-use-cases-tenant.ts (L125-133)

**変更内容**:
```typescript
// 削除された部分
if (
  controlPlane.account &&
  !app.node.getAllContext()['controlPlaneAccount']
) {
  app.node.setContext('controlPlaneAccount', controlPlane.account);
}
```

**影響**:
- CDKコンテキストとして `controlPlaneAccount` が設定されなくなる
- スタックやConstructで `this.node.tryGetContext('controlPlaneAccount')` を使用している箇所があれば動作しなくなる

### 3. openFgaConfig の必須化による破壊的変更
**ファイル**: packages/cdk/bin/generative-ai-use-cases-tenant.ts (L162-166)

**問題内容**:
```typescript
if (!context.openFgaConfig) {
  throw new Error(
    'openFgaConfig is required in cdk.tenant.json. Please add the complete openFgaConfig section with rds, ecs, logging, and apiGateway settings.'
  );
}
```

**影響**:
- 既存のテナント設定ファイル（openFgaConfig を含まない）でデプロイできなくなる
- マイグレーションパスやドキュメントが必要

**推奨対応**:
- マイグレーションガイドの作成
- 既存テナントへの影響範囲の確認

---

## 軽微な問題・改善提案（Info）

### 1. maxAzs の変更（1 → 2）
**ファイル**: packages/cdk/cdk.tenant.example.json (L32)

**変更内容**:
```json
"maxAzs": 2  // 以前は 1
```

**影響**:
- 高可用性の向上（推奨される変更）
- ただし、コストが増加する可能性がある
- 既存テナントがmaxAzs=1で運用している場合、設定変更時にリソースの再作成が発生する可能性

**推奨**:
- example.json としては適切な設定
- 既存テナント更新時は注意が必要

### 2. 新規追加の設定検証が強化されている
**ファイル**: packages/cdk/bin/generative-ai-use-cases-tenant.ts (L153-166)

**良い点**:
- openSearchConfig, networkConfig, openFgaConfig の必須化
- 早期エラー検出により、デプロイ時の問題を防止
- エラーメッセージが具体的で分かりやすい

### 3. tenantsTableName のデフォルト値生成ロジックが削除
**ファイル**: packages/cdk/bin/generative-ai-use-cases-tenant.ts

**変更前**:
```typescript
tenantsTableName: context.controlPlane?.tenantsTableName || `Tenants-${context.environment || 'dev'}`
```

**変更後**:
削除（パラメータ自体が削除）

**影響**:
- テナント管理テーブル名の動的生成が行われなくなる
- この機能が本当に不要なのか確認が必要

### 4. example.json のフォーマット統一
**ファイル**: packages/cdk/cdk.tenant.example.json

**変更内容**:
- 不要なフィールド（tenantsTableName, openSearchIndexName）の削除
- openFgaConfig の追加（詳細な設定値を含む）

**良い点**:
- example として完全な設定例を提供
- 新規テナント作成時に必要な全ての設定が明示されている

---

## 総合評価

**要修正**

### 修正が必要な項目（優先度順）:

1. **Critical: cdk.context.json のセキュリティ対応（最優先）**
   - AWSアカウント番号がバージョン管理されている
   - .gitignore に追加し、既存のコミットから削除する必要がある

2. **Warning: 削除されたパラメータの影響調査**
   - controlPlaneRegion, controlPlaneAccount, tenantsTableName, openSearchIndexName
   - これらが他のスタックで使用されていないことを確認

3. **Warning: 破壊的変更への対応**
   - openFgaConfig の必須化
   - 既存テナントのマイグレーション計画が必要

### その他の推奨事項:

4. maxAzs=1 で運用中の既存テナントへの影響を文書化
5. 削除されたデフォルト値生成ロジック（tenantsTableName）の必要性を再確認

### 良い点:

- 設定検証の強化により、デプロイ時のエラーを早期に検出できる
- example.json が充実し、新規テナント作成のガイドとして機能する
- インターフェース定義が整理され、型安全性が向上している
- コードフォーマットが統一されている
