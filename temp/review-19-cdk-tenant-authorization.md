# レビュー結果: CDK Tenant Authorization Stack

## 担当ファイル
- packages/cdk/lib/stacks/tenant/tenant-authorization-stack.ts (新規作成)

## 重大な問題（Critical）

### 1. テーブル名が環境変数として Lambda 関数に渡されていない
**場所**: packages/cdk/lib/construct/authorization-system.ts 行193-204

**問題内容**:
AuthorizationSystemコンストラクトでは、Lambda関数に共通の環境変数として`ENVIRONMENT`のみを設定していますが、テーブル名（`usageCounterTableName`、`permissionGrantTableName`）を渡していません。

```typescript
const commonEnvironment = {
  ENVIRONMENT: environment,
};
```

Lambda関数側（grantPermission.ts等）では、テーブル名を動的に生成する`getTableName`関数を使用していますが、これはCDKで作成されたテーブル名と一致する保証がありません。

**期待される実装**:
```typescript
const commonEnvironment = {
  ENVIRONMENT: environment,
  USAGE_COUNTER_TABLE_NAME: this.usageCounterTable.tableName,
  PERMISSION_GRANT_TABLE_NAME: this.permissionGrantTable.tableName,
};
```

**影響度**: Critical - 実行時にテーブルが見つからず、全ての権限管理機能が動作しない可能性があります。

### 2. テナントロールARNがLambda関数に渡されていない
**場所**: packages/cdk/lib/construct/authorization-system.ts 行193-204

**問題内容**:
`tenantRoleArn`がAuthorizationSystemコンストラクトのpropsとして受け取られていますが、Lambda関数の環境変数として設定されていません。

```typescript
export interface AuthorizationSystemProps {
  readonly tenantRoleArn: string;  // 受け取っているが使用されていない
}
```

Lambda関数がテナントロールをAssumeする際に、このARNが必要ですが、現状では環境変数として渡されていないため、Lambda関数側でハードコーディングするか別の方法で取得する必要があります。

**期待される実装**:
```typescript
const commonEnvironment = {
  ENVIRONMENT: environment,
  TENANT_ROLE_ARN: props.tenantRoleArn,
};
```

**影響度**: Critical - テナント固有のリソースへのアクセスができず、OpenFGAとの連携が機能しません。

### 3. AssumeRoleポリシーのリソースが広すぎる
**場所**: packages/cdk/lib/construct/authorization-system.ts 行314-318

**問題内容**:
```typescript
const assumeRolePolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['sts:AssumeRole'],
  resources: ['arn:aws:iam::*:role/TenantRole-*'],  // ワイルドカードで全アカウント
});
```

全てのAWSアカウントの`TenantRole-*`パターンのロールをAssumeできるため、過度に広い権限です。

**期待される実装**:
```typescript
const assumeRolePolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['sts:AssumeRole'],
  resources: [props.tenantRoleArn],  // 特定のテナントロールに限定
});
```

**影響度**: Critical - セキュリティリスク（最小権限の原則違反）

## 警告レベルの問題（Warning）

### 4. OpenFGA APIエンドポイントのリソースパターンが広すぎる
**場所**: packages/cdk/lib/construct/authorization-system.ts 行331-335

**問題内容**:
```typescript
const openFgaInvokePolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['execute-api:Invoke'],
  resources: ['arn:aws:execute-api:*:*:*/prod/*'],  // 全リージョン・全アカウントのAPI
});
```

全てのリージョン・アカウントのAPI Gatewayにアクセスできる権限となっています。

**期待される実装**:
テナント専用のOpenFGA APIエンドポイントが作成されている場合、そのARNに限定すべきです。ただし、OpenFGA APIエンドポイントが別スタックで管理されている場合は、SSMパラメータから取得するか、スタック間で参照を渡す必要があります。

**影響度**: Warning - セキュリティリスク（過剰な権限付与）

### 5. SSMパラメータのリソースパターンが広すぎる
**場所**: packages/cdk/lib/construct/authorization-system.ts 行347-355

**問題内容**:
```typescript
const ssmParameterReadPolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  resources: [
    `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiEndpoint`,
    `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaApiRegion`,
    `arn:aws:ssm:*:*:parameter/genu-gaixer/tenants/*/openFgaStoreId`,
  ],
});
```

全リージョン・全アカウントの全テナントのパラメータを読み取り可能です。

**期待される実装**:
```typescript
const ssmParameterReadPolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['ssm:GetParameter'],
  resources: [
    `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/genu-gaixer/tenants/${props.tenantId}/openFgaApiEndpoint`,
    `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/genu-gaixer/tenants/${props.tenantId}/openFgaApiRegion`,
    `arn:aws:ssm:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:parameter/genu-gaixer/tenants/${props.tenantId}/openFgaStoreId`,
  ],
});
```

**影響度**: Warning - セキュリティリスク（テナント間の情報漏洩の可能性）

### 6. テナントマネージャーテーブル名がハードコーディング
**場所**: packages/cdk/lib/construct/authorization-system.ts 行366-375

**問題内容**:
```typescript
const tenantTableReadPolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['dynamodb:Scan', 'dynamodb:GetItem'],
  resources: [
    `arn:aws:dynamodb:${cdk.Stack.of(this).region}:${
      cdk.Stack.of(this).account
    }:table/TenantManager-${environment}`,  // テーブル名がハードコーディング
  ],
});
```

テナントマネージャーテーブルの実際の名前が`TenantManager-${environment}`と異なる場合に問題が発生します。

**期待される実装**:
propsでテナントマネージャーテーブルのARNまたは名前を受け取るべきです。

**影響度**: Warning - 設定によっては実行時エラーが発生

### 7. EventBridgeルールの名前が環境ごとに共通
**場所**: packages/cdk/lib/construct/authorization-system.ts 行383-393, 405-418

**問題内容**:
```typescript
const dailyResetRule = new events.Rule(this, 'DailyUsageCountResetRule', {
  ruleName: `DailyUsageCountReset-${environment}`,  // テナントIDが含まれていない
  // ...
});

const monthlyResetRule = new events.Rule(this, 'MonthlyUsageCountResetRule', {
  ruleName: `MonthlyUsageCountReset-${environment}`,  // テナントIDが含まれていない
  // ...
});
```

同一環境に複数のテナントがデプロイされる場合、ルール名が重複してデプロイに失敗します。

**期待される実装**:
```typescript
ruleName: `DailyUsageCountReset-${environment}-${props.tenantId}`
ruleName: `MonthlyUsageCountReset-${environment}-${props.tenantId}`
```

**影響度**: Warning - マルチテナント環境でのデプロイ失敗

### 8. resetUsageCount Lambdaのタイムアウトが長すぎる可能性
**場所**: packages/cdk/lib/construct/authorization-system.ts 行282

**問題内容**:
```typescript
timeout: cdk.Duration.minutes(15), // Long timeout for batch processing
```

15分のタイムアウトは非常に長く、テナント単位のリセット処理としては過剰な可能性があります。この関数がすべてのテナントをスキャンして処理する設計になっている場合は妥当ですが、テナント固有のスタックであることを考えると設計の見直しが必要です。

**確認事項**:
- resetUsageCount関数は単一テナントの処理のみか、全テナントを処理するのか
- 全テナント処理の場合、なぜテナント固有のスタックにこの関数があるのか

**影響度**: Warning - 設計の不整合の可能性

## 軽微な問題・改善提案（Info）

### 9. CfnOutputの重複
**場所**: packages/cdk/lib/stacks/tenant/tenant-authorization-stack.ts 行87-143

**問題内容**:
AuthorizationSystemコンストラクトで既にCfnOutputを作成している（行434-467）のに、TenantAuthorizationStackで再度同じ値をCfnOutputとして出力しています。

```typescript
// AuthorizationSystemコンストラクト内
new cdk.CfnOutput(this, 'UsageCounterTableName', { ... });

// TenantAuthorizationStack内
new cdk.CfnOutput(this, 'StackUsageCounterTableName', { ... });
```

**影響**: 実害はありませんが、出力が重複して冗長になります。

**改善提案**:
- Constructレベルでの出力は削除し、Stackレベルのみで出力する
- または、Constructレベルの出力のみにして、Stack側では`exportName`を追加するのみにする

### 10. tenantIdのCfnParameterの妥当性
**場所**: packages/cdk/lib/stacks/tenant/tenant-authorization-stack.ts 行60-70

**問題内容**:
```typescript
const tenantId =
  props.tenantId ||
  new cdk.CfnParameter(this, 'TenantId', {
    // ...
  }).valueAsString;
```

通常のテナント管理システムでは、テナントIDはデプロイ時に確定しているべきで、CloudFormationパラメータとして動的に受け取る設計は推奨されません。

**理由**:
- テナントIDはリソース名やタグに使用されるため、デプロイ後に変更不可
- パラメータとして受け取ると、誤った値での実行リスクが高まる

**改善提案**: `tenantId`をpropsの必須項目にする

```typescript
export interface TenantAuthorizationStackProps extends cdk.StackProps {
  readonly tenantId: string;  // オプショナルを削除
}
```

### 11. removalPolicyのデフォルト値
**場所**: packages/cdk/lib/stacks/tenant/tenant-authorization-stack.ts 行35

**問題内容**:
```typescript
/**
 * @default RemovalPolicy.RETAIN for production, DESTROY for dev
 */
readonly removalPolicy?: cdk.RemovalPolicy;
```

ドキュメントには「productionではRETAIN、devではDESTROY」と書かれていますが、実際にはAuthorizationSystemコンストラクト側でこのロジックを実装しています（行99-103）。StackレベルでremovalPolicyが未指定の場合、undefinedがそのまま渡されるため、Construct側のロジックが正しく動作します。

**改善提案**:
Stack側でもデフォルト値を設定するか、ドキュメントを「Construct側でデフォルト値を決定」と明記する。

### 12. 未使用のprops
**場所**: packages/cdk/lib/stacks/tenant/tenant-authorization-stack.ts 行29

**問題内容**:
```typescript
readonly tenantRoleArn: string;
```

このpropsはAuthorizationSystemコンストラクトに渡されていますが、前述の通りLambda関数の環境変数として使用されていません。

**影響**: Critical問題#2と連動

### 13. タグの型変換
**場所**: packages/cdk/lib/stacks/tenant/tenant-authorization-stack.ts 行146

**問題内容**:
```typescript
cdk.Tags.of(this).add('TenantId', tenantId.toString());
```

`tenantId`は既にstringまたはCfnParameter.valueAsString（これもstring）なので、`.toString()`は不要です。

**改善提案**:
```typescript
cdk.Tags.of(this).add('TenantId', tenantId);
```

### 14. Lambdaランタイムの不整合
**場所**: packages/cdk/lib/construct/authorization-system.ts

**問題内容**:
- grantPermissionFunction, revokePermissionFunction: NODEJS_20_X (デフォルト)
- checkPermissionFunction: NODEJS_20_X（明示的に指定）行244
- incrementUsageCountFunction: NODEJS_20_X（明示的に指定）行263
- resetUsageCountFunction: NODEJS_20_X（明示的に指定）行281

一部の関数では`runtime`が明示的に再指定されていますが、`commonLambdaProps`で既に`NODEJS_20_X`が設定されているため冗長です。

**改善提案**:
すべて`commonLambdaProps`に統一するか、個別に設定が必要な理由をコメントで明記する。

### 15. checkPermissionFunctionのメモリサイズとタイムアウト
**場所**: packages/cdk/lib/construct/authorization-system.ts 行245-246

**問題内容**:
```typescript
timeout: cdk.Duration.seconds(10), // Faster timeout for check operations
memorySize: 256, // Lower memory for check operations
```

これらの設定は`commonLambdaProps`（タイムアウト30秒、メモリ512MB）を上書きしています。パフォーマンスチェック関数としては妥当な最適化ですが、incrementUsageCountFunctionでも同様の設定（行264-265）を行っているため、共通化できる可能性があります。

**改善提案**:
「軽量操作用」と「重量操作用」の2種類の共通設定を用意する。

## 総合評価
**要修正**

### 評価理由
3つのCritical問題が存在し、いずれも実行時に機能不全を引き起こす可能性があります。

**必須修正項目**:
1. テーブル名を環境変数として渡す（Critical #1）
2. テナントロールARNを環境変数として渡す（Critical #2）
3. IAMポリシーのリソース範囲を最小化（Critical #3）

**推奨修正項目**:
4. OpenFGA API、SSMパラメータ、TenantManagerテーブルのリソース範囲を特定のテナントに限定（Warning #4, #5, #6）
5. EventBridgeルール名にテナントIDを含める（Warning #7）
6. resetUsageCount関数の設計を確認・見直し（Warning #8）

### アーキテクチャ上の懸念
このスタックは「テナント固有」のスタックとして設計されていますが、一部のLambda関数（特にresetUsageCount）が全テナントを処理する設計になっている可能性があります。テナント分離の観点から、以下の点を確認すべきです：

1. resetUsageCount関数は本当にこのスタックに配置すべきか
2. 各テナントが独自のEventBridgeルールでresetを実行する設計が適切か
3. 全テナント一括リセットが必要な場合、管理アカウント側に配置すべきではないか

### 他のテナントスタックとの整合性
TenantOpenFgaStackと比較すると、以下の点で設計パターンが異なります：

**TenantOpenFgaStack（良い例）**:
- テナントIDが必須項目
- リソース名にテナントIDを含める
- SSMパラメータでテナント固有の設定を管理
- IAMポリシーが適切にスコープされている

**TenantAuthorizationStack（改善が必要）**:
- テナントIDがオプショナル
- EventBridgeルール名にテナントIDがない
- IAMポリシーのリソース範囲が広すぎる
- Lambda関数への環境変数の設定が不足

設計パターンをTenantOpenFgaStackに合わせることで、一貫性と保守性が向上します。
