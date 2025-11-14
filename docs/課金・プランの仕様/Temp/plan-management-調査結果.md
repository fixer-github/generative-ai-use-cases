# Plan Management責務 Internal関数 調査結果

## 調査概要

- 調査対象ディレクトリ: `/packages/cdk/lambda/billing/plan-management/`
- 調査ファイル数: 3つのInternal関数（applyPlanToUser.ts、terminatePlanApplication.ts、updatePlanApplicationStatus.ts）
- 調査基準: `docs/課金・プランの仕様/購入・変更・解約などの複数ステップの処理を統括する/技術実装詳細.md`の期待仕様との一致度
- 調査日時: 2025-11-14

---

## applyPlanToUser関数

### 実装状況
**実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/plan-management/applyPlanToUser.ts`

### シグネチャの一致度
**部分一致（重大な差異あり）**

#### 技術実装詳細.mdの期待仕様
```typescript
applyPlanToUser(tenantId, userId, planId, source, sourceId)
// 出力: grantId (権限付与ID)
```

#### 実装されている仕様
```typescript
interface ApplyPlanToUserInput {
  userId: string;
  planId: string;
  applicationSource: 'subscription' | 'default' | 'trial' | 'campaign' | 'manual';
  applicationSourceId?: string; // オプショナル
  validFrom: string; // ISO 8601
  validUntil?: string; // ISO 8601
  tenantId: string;
}

interface ApplyPlanToUserOutput {
  applicationId: string; // ← grantIdではない
  userId: string;
  planId: string;
  applicationStatus: 'active' | 'scheduled_termination' | 'expired';
  validFrom: string;
  validUntil?: string;
  previousApplicationIds: string[];
}
```

### 問題点

1. **入力パラメータの差異**:
   - 技術実装詳細.mdでは`source`と`sourceId`のみだが、実装では`validFrom`と`validUntil`も**必須/推奨**パラメータとして追加されている
   - `sourceId`が技術実装詳細.mdでは必須だが、実装ではオプショナル（`applicationSourceId?`）

2. **出力パラメータの差異（重大）**:
   - 技術実装詳細.mdでは`grantId`（権限付与ID）を返すことを期待
   - 実装では`applicationId`（プラン適用ID）を返している
   - **統括責務が期待する「権限付与ID」が返されない**

3. **Lambda関数としての定義**:
   - Lambda関数として正しく定義されている（CDKでも確認）
   - 関数名: `${environment}-billing-plan-internal-apply`
   - 他の統括責務からLambda invokeで呼び出し可能

4. **処理内容**:
   - プランの存在確認 → 実装済み
   - 既存のアクティブなプラン適用を終了 → 実装済み
   - 新しいプラン適用レコードを作成 → 実装済み
   - **権限付与処理が欠落**（技術実装詳細.mdでは「ステップ6: 権限付与」として期待されているが、実装されていない）

---

## terminatePlanApplication関数

### 実装状況
**実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/plan-management/terminatePlanApplication.ts`

### シグネチャの一致度
**不一致（重大な差異あり）**

#### 技術実装詳細.mdの期待仕様
```typescript
terminatePlanApplication(tenantId, userId, planApplicationId, immediate)
// immediate: 即座終了かどうか (boolean)
```

#### 実装されている仕様
```typescript
interface TerminatePlanApplicationInput {
  userId: string;
  applicationSourceId: string; // サブスクリプションIDなど
  tenantId: string;
  // immediateパラメータが存在しない
}

interface TerminatePlanApplicationOutput {
  applicationId: string;
  previousStatus: 'active' | 'scheduled_termination';
  newStatus: 'expired';
  terminatedAt: string;
}
```

### 問題点

1. **入力パラメータの重大な差異**:
   - 技術実装詳細.mdでは`planApplicationId`を受け取ることを期待
   - 実装では`applicationSourceId`（サブスクリプションIDなど）を受け取る
   - **`planApplicationId`で直接プラン適用を特定できない**
   - **`immediate`パラメータが完全に欠落**（即座終了か期限終了時終了かを制御できない）

2. **処理の違い**:
   - 技術実装詳細.mdでは`immediate: true`の場合は即座にプラン適用を終了、`immediate: false`の場合は`scheduled_termination`に変更することを期待
   - 実装では**常に`expired`（期限切れ）に変更**している
   - **`scheduled_termination`への変更処理が欠落**

3. **Lambda関数としての定義**:
   - Lambda関数として正しく定義されている（CDKでも確認）
   - 関数名: `${environment}-billing-plan-internal-terminate`

4. **統括責務への影響**:
   - 解約フローで「期限終了時解約」を実装する際に、`immediate`パラメータがないため制御不可
   - `planApplicationId`を直接指定できないため、統括責務側で`applicationSourceId`を管理する必要がある（技術実装詳細.mdの想定外の依存関係）

---

## updatePlanApplicationStatus関数

### 実装状況
**実装済み**

### ファイルパス
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lambda/billing/plan-management/updatePlanApplicationStatus.ts`

### シグネチャの一致度
**部分一致**

#### 技術実装詳細.mdの期待仕様
```typescript
updatePlanApplicationStatus(tenantId, planApplicationId, status)
```

#### 実装されている仕様
```typescript
interface UpdatePlanApplicationStatusInput {
  applicationId: string; // ← planApplicationIdではなくapplicationId
  newStatus?: 'active' | 'scheduled_termination' | 'expired';
  validUntil?: string; // ISO 8601（技術実装詳細.mdには記載なし）
  tenantId: string;
}

interface UpdatePlanApplicationStatusOutput {
  applicationId: string;
  previousStatus: 'active' | 'scheduled_termination' | 'expired';
  newStatus: 'active' | 'scheduled_termination' | 'expired';
  validUntil?: string;
  updatedAt: string;
}
```

### 問題点

1. **パラメータ名の差異**:
   - 技術実装詳細.mdでは`planApplicationId`だが、実装では`applicationId`
   - これは名称の違いのみで、機能的には同じ（軽微な差異）

2. **追加機能**:
   - 技術実装詳細.mdにはない`validUntil`（有効期限延長）機能が実装されている
   - これは技術実装詳細.mdの「Webhookイベント処理フロー」で`payment.succeeded`時に「プラン適用有効期限延長」が必要とされているため、追加実装された可能性がある
   - **正の差異**として評価可能

3. **Lambda関数としての定義**:
   - Lambda関数として正しく定義されている（CDKでも確認）
   - 関数名: `${environment}-billing-plan-internal-update-status`

4. **処理内容**:
   - applicationIdでプラン適用を検索 → 実装済み
   - ステータスまたは有効期限を更新 → 実装済み
   - 期待される処理がすべて実装されている

---

## 統括責務が動作する上で必須の修正事項

### 1. applyPlanToUser関数の修正
**優先度: 最高（統括責務の購入フロー・プラン変更フローが動作不可）**

- **問題**: 技術実装詳細.mdが期待する`grantId`（権限付与ID）が返されない
- **影響**: 統括責務の購入フローステップ6「権限付与」、プラン変更フローステップ6「新しいプラン適用」が完了できない
- **必要な修正**:
  1. 出力に`grantId`を追加するか、または技術実装詳細.mdの期待仕様を`applicationId`に修正する
  2. プラン適用後の**権限付与処理**を実装する（Authorization責務のInternal関数を呼び出す、またはapplyPlanToUser内で権限付与まで完結させる）

### 2. terminatePlanApplication関数の修正
**優先度: 最高（統括責務の解約フローが正しく動作不可）**

- **問題1**: `immediate`パラメータが欠落
- **影響**: 解約フローで「即時解約」と「期限終了時解約」を区別できない
- **必要な修正**:
  1. `immediate: boolean`パラメータを入力に追加
  2. `immediate: true`の場合は`expired`に変更、`immediate: false`の場合は`scheduled_termination`に変更する処理を実装

- **問題2**: `planApplicationId`ではなく`applicationSourceId`で検索
- **影響**: 統括責務がプラン適用IDを直接指定できない（サブスクリプションIDを経由する必要がある）
- **必要な修正**:
  1. 入力パラメータを`planApplicationId`に変更（技術実装詳細.mdの想定通り）
  2. または、技術実装詳細.mdの想定を`applicationSourceId`に修正（ただし、統括責務側の実装が複雑になる）

### 3. updatePlanApplicationStatus関数の修正
**優先度: 低（パラメータ名の不一致のみ、機能的には動作可能）**

- **問題**: パラメータ名が`planApplicationId`ではなく`applicationId`
- **影響**: 軽微（統括責務側で`applicationId`として渡せば動作する）
- **推奨修正**:
  1. 技術実装詳細.mdの仕様に合わせて`planApplicationId`に統一（一貫性向上）
  2. または、技術実装詳細.mdを`applicationId`に修正

---

## 補足事項

### 1. CDK定義の確認結果
`/Users/hosoya.naoki/Documents/genu-gaixer/generative-ai-use-cases/packages/cdk/lib/construct/api/plan-management.ts`を確認したところ、3つのInternal関数すべてが正しくLambda関数として定義されており、統括責務から呼び出せるように`internalFunctions`プロパティとして公開されている。

```typescript
public readonly internalFunctions: {
  applyPlanToUser: NodejsFunction;
  terminatePlanApplication: NodejsFunction;
  updatePlanApplicationStatus: NodejsFunction;
};
```

### 2. RDS接続の実装
すべてのInternal関数で、テナント専用のRDS接続（`getRdsConnection`）が正しく実装されており、マルチテナント対応がされている。

### 3. エラーハンドリング
各関数で専用のエラークラス（`ApplyPlanToUserError`、`TerminatePlanApplicationError`、`UpdatePlanApplicationStatusError`）が実装されており、統括責務側でエラー種別を判定してリトライや部分ロールバックを制御可能。

### 4. 技術実装詳細.mdとの整合性
技術実装詳細.mdの「planManagementClient.ts」セクション（314-318行）では、以下のメソッドが期待されている:

```typescript
- applyPlanToUser(tenantId, userId, planId, source, sourceId): プラン適用
- terminatePlanApplication(tenantId, userId, planApplicationId, immediate): プラン適用終了
- updatePlanApplicationStatus(tenantId, planApplicationId, status): プラン適用状態更新
```

現在の実装はこの期待仕様と**重大な差異**があるため、統括責務側の実装（planManagementClient.ts）が技術実装詳細.mdの想定通りに動作しない可能性が高い。

### 5. 次のステップ
統括責務の実装を開始する前に、以下のいずれかを実施する必要がある:

- **オプションA**: Plan Management責務のInternal関数を技術実装詳細.mdの仕様に合わせて修正
- **オプションB**: 技術実装詳細.mdを現在の実装に合わせて更新し、統括責務側の実装をそれに従う

**推奨**: オプションA（Internal関数の修正）。理由は、技術実装詳細.mdの設計が統括責務の処理フローに最適化されており、現在の実装の差異を修正する方が全体の整合性が保たれるため。
