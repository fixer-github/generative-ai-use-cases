# レビュー結果: Web Hooks

## 担当ファイル
- packages/web/src/hooks/useAssistantApi.ts
- packages/web/src/hooks/useAssistantForm.ts
- packages/web/src/hooks/useHttp.ts
- packages/web/src/hooks/usePlanApi.ts (新規)

## 重大な問題（Critical）

### 1. usePlanApi.ts: PATCH メソッドが未実装
**ファイル**: packages/web/src/hooks/usePlanApi.ts (行202-206)

**問題内容**:
```typescript
updatePlanStatus: async (
  planId: string,
  statusData: UpdatePlanStatusRequest
): Promise<UpdatePlanStatusResponse> => {
  const response = await api.patch<UpdatePlanStatusResponse>(
    `/plans/${planId}/status`,
    statusData
  );
  return response.data;
},
```

usePlanApi は `api.patch()` を呼び出していますが、`useBillingHttp` には `patch` メソッドが実装されていません。

**影響**:
- `updatePlanStatus` の呼び出し時にランタイムエラーが発生します
- プランのステータス更新機能が動作しません

**修正方法**:
- `useBillingHttp` (および `useHttp`) に `patch` メソッドを追加する
- または、`updatePlanStatus` を `put` メソッドを使用するように変更する

---

### 2. useHttp.ts: 環境変数 VITE_APP_BILLING_API_ENDPOINT が未定義の可能性
**ファイル**: packages/web/src/hooks/useHttp.ts (行12-14)

**問題内容**:
```typescript
const billingApi = axios.create({
  baseURL: import.meta.env.VITE_APP_BILLING_API_ENDPOINT,
});
```

`VITE_APP_BILLING_API_ENDPOINT` 環境変数の定義が .env ファイルに見つかりませんでした。

**影響**:
- billingApi の baseURL が undefined になり、すべての billing API リクエストが失敗します
- usePlanApi の全メソッドが動作しません

**修正方法**:
- .env.template や .env ファイルに `VITE_APP_BILLING_API_ENDPOINT` を追加する
- または、ビルド設定に環境変数を追加する

---

## 警告レベルの問題（Warning）

### 1. useAssistantApi.ts: AbortSignal パラメータの削除による機能退化
**ファイル**: packages/web/src/hooks/useAssistantApi.ts (行38-44)

**変更内容**:
```diff
- listAssistants: async (
-   params?: ListAssistantsQueryParams,
-   signal?: AbortSignal
- ): Promise<ListAssistantsResponse> => {
+ listAssistants: async (
+   params?: ListAssistantsQueryParams
+ ): Promise<ListAssistantsResponse> => {
   const queryString = buildQueryString(params);
   const url = queryString ? `assistant?${queryString}` : 'assistant';
-  const res = await http.api.get<ListAssistantsResponse>(url, { signal });
+  const res = await http.api.get<ListAssistantsResponse>(url);
   return res.data;
 },
```

**問題**:
- リクエストのキャンセル機能が削除されました
- ユーザーがページを離れた場合、不要なリクエストが継続する可能性があります
- React 18 の Strict Mode やコンポーネントのアンマウント時に問題が発生する可能性があります

**推奨対応**:
- AbortSignal のサポートを維持することを推奨します
- または、削除の理由が明確であれば、コメントで説明を追加してください

---

### 2. useAssistantApi.ts: updateAssistantVisibility メソッドの削除
**ファイル**: packages/web/src/hooks/useAssistantApi.ts (行77-87)

**削除されたコード**:
```typescript
updateAssistantVisibility: async (
  assistantId: string,
  visibility: 'private' | 'public'
): Promise<Assistant> => {
  const res = await http.put<Assistant, { visibility: 'private' | 'public' }>(
    `assistant/${assistantId}`,
    { visibility }
  );
  return res.data;
},
```

**問題**:
- このメソッドを使用しているコンポーネントがある場合、ビルドエラーまたはランタイムエラーが発生します
- 機能が意図的に削除されたのか、リファクタリング中なのか不明確です

**確認事項**:
- このメソッドを使用している場所がないか確認が必要です
- 削除が意図的であれば、呼び出し元も併せて削除されているか確認してください

---

### 3. useAssistantForm.ts: visibility フィールドの削除
**ファイル**: packages/web/src/hooks/useAssistantForm.ts (行6-13、行35-41)

**削除された内容**:
```diff
export type AssistantFormData = {
  name: string;
  description: string;
  instruction: string;
  modelId: string;
  ragEnabled: boolean;
- visibility: 'private' | 'public';
  knowledgeSources: KnowledgeSource[];
};

const getInitialFormData = (
  initialData?: Partial<AssistantFormData>
): AssistantFormData => ({
  name: initialData?.name || '',
  description: initialData?.description || '',
  instruction: initialData?.instruction || '',
  modelId: initialData?.modelId || MODELS.modelIds[0] || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  ragEnabled: initialData?.ragEnabled || false,
- visibility: initialData?.visibility || 'private',
  knowledgeSources: initialData?.knowledgeSources || [],
});
```

**問題**:
- `updateAssistantVisibility` の削除と連動していると思われますが、一貫性の確認が必要です
- このフォームを使用しているUIコンポーネントとの整合性を確認する必要があります

**確認事項**:
- visibility フィールドを使用しているコンポーネントがないか確認が必要です
- バックエンドのスキーマとの整合性を確認してください

---

## 軽微な問題・改善提案（Info）

### 1. useHttp.ts: コードの重複（DRY原則違反）
**ファイル**: packages/web/src/hooks/useHttp.ts (行111-221, 274-384)

**問題**:
`useHttp` と `useBillingHttp` のコードがほぼ完全に重複しています（約110行の重複コード）。

**改善提案**:
以下のようなヘルパー関数を作成して重複を削減できます：

```typescript
const createHttpHook = (axiosInstance: AxiosInstance, fetcher: (url: string) => Promise<any>) => {
  return {
    api: axiosInstance,
    fetcher,
    get: <Data = any, Error = any>(url: string | null, config?: SWRConfiguration) => {
      return useSWR<Data, Error>(url, fetcher, config);
    },
    // ... 他のメソッド
  };
};

const useHttp = () => createHttpHook(api, fetcher);
const useBillingHttp = () => createHttpHook(billingApi, billingFetcher);
```

**メリット**:
- コードの保守性向上
- バグ修正時の修正箇所の削減
- 将来的に新しいAPI エンドポイント追加時の拡張性向上

---

### 2. usePlanApi.ts: クエリパラメータ構築の一貫性
**ファイル**: packages/web/src/hooks/usePlanApi.ts (行162-173)

**現状**:
クエリパラメータの構築が各メソッドで手動で行われています。

**改善提案**:
useAssistantApi.ts の `buildQueryString` のようなヘルパー関数を作成して、コードの一貫性と保守性を向上させることができます：

```typescript
function buildQueryString(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';

  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      queryParams.append(key, value.toString());
    }
  });
  return queryParams.toString();
}
```

---

### 3. usePlanApi.ts: 型定義の詳細度
**ファイル**: packages/web/src/hooks/usePlanApi.ts (全体)

**良い点**:
- 型定義が非常に詳細で、API仕様が明確に定義されています
- TypeScript の型安全性が十分に活用されています

**改善提案**:
- これらの型定義を別ファイル（例: `types/plan.ts`）に分離することで、再利用性と保守性が向上します
- バックエンドの型定義と共有できる可能性があります

---

### 4. useHttp.ts: setupInterceptors 関数の命名
**ファイル**: packages/web/src/hooks/useHttp.ts (行17-93)

**改善提案**:
`setupInterceptors` は副作用を持つ関数なので、`setupAxiosInterceptors` などのより具体的な名前にすることで、コードの可読性が向上します。

---

### 5. usePlanApi.ts: エラーハンドリングの欠如
**ファイル**: packages/web/src/hooks/usePlanApi.ts (全メソッド)

**現状**:
すべてのメソッドで try-catch によるエラーハンドリングが行われていません。

**推奨事項**:
- axios interceptor でグローバルエラーハンドリングを行っているため、個別のエラーハンドリングは不要かもしれません
- ただし、特定のエラー（404など）を個別に処理する必要がある場合は、オプショナルなエラーハンドラーを追加することを検討してください

---

### 6. useAssistantApi.ts: useMemo の依存配列
**ファイル**: packages/web/src/hooks/useAssistantApi.ts (行111)

**現状**:
```typescript
// eslint-disable-next-line react-hooks/exhaustive-deps
[] // http.api is stable - created once at module level in useHttp.ts
```

**確認事項**:
コメントでは「http.api は stable」と記載されていますが、useHttp() の呼び出しごとに新しいオブジェクトが返されます。
実際には問題ない可能性がありますが、以下を確認することを推奨します：

- useHttp が実際に同じオブジェクトを返すか確認
- または、依存配列に [http.api] を含める

---

### 7. TypeScript strict mode の型アノテーション
**全ファイル**: 共通

**良い点**:
- 明示的な型アノテーションが適切に使用されています
- ジェネリクスが効果的に活用されています

**軽微な改善点**:
- 一部の `any` 型（eslint-disable-next-line 付き）を `unknown` に変更することで、型安全性がさらに向上します

---

## 総合評価

**要修正**

### 評価理由:
2つの重大な問題（Critical）が検出されました：
1. **PATCH メソッドの未実装** - usePlanApi の updatePlanStatus が動作しません
2. **環境変数の未定義** - VITE_APP_BILLING_API_ENDPOINT が設定されていないため、すべての billing API リクエストが失敗します

これらの問題はランタイムエラーを引き起こすため、修正が必須です。

### 肯定的な評価:
- **Billing API の分離設計**: 既存の API と billing API を適切に分離し、別々の axios インスタンスで管理する設計は優れています
- **型定義の品質**: usePlanApi の型定義は非常に詳細で、API仕様が明確に表現されています
- **インターセプタの共通化**: `setupInterceptors` 関数による重複排除は良いアプローチです
- **React Hooks のベストプラクティス**: useMemo の適切な使用、カスタムフックの適切な分離など、React のベストプラクティスに従っています

### 修正推奨順位:
1. **最優先**: PATCH メソッドの実装または PUT への変更
2. **最優先**: VITE_APP_BILLING_API_ENDPOINT 環境変数の設定
3. **推奨**: updateAssistantVisibility と visibility フィールド削除の影響範囲確認
4. **推奨**: AbortSignal サポートの復元または削除理由の明記
5. **任意**: コードの重複削減（DRY原則の適用）

### 次のステップ:
1. Critical 問題の修正
2. 削除されたメソッド・フィールドの影響範囲調査（他のファイルのレビューで判明する可能性あり）
3. 軽微な改善点の対応検討
