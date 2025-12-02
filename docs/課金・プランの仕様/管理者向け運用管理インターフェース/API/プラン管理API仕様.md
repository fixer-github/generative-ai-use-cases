# プラン管理API仕様

## 概要

このドキュメントでは、管理者向け運用管理インターフェースのプラン管理ページが機能するために必要なAPIエンドポイントの仕様を定義します。

これらのAPIエンドポイントは、以下の機能を実現するために使用されます：

- プラン一覧の取得（検索・絞り込み・ソート機能付き）
- プラン詳細情報の取得
- 新規プランの作成
- プランステータスの変更
- プラン変更履歴の取得
- プラン契約状況の取得
- 内部名称の重複チェック

---

## 共通仕様

### 認証・認可

すべてのエンドポイントは、以下の認証・認可要件を満たす必要があります：

1. **認証**：有効なセッショントークンまたはAPIキーによる認証が必須です
2. **認可**：OpenFGAによる管理者権限の検証が必須です
   - 各リクエスト処理の開始時に、OpenFGAに対して「このユーザは管理者ですか？」と問い合わせます
   - 管理者権限がない場合は、`403 Forbidden`エラーを返します

### 監査ログ

すべての変更操作（プラン作成、ステータス変更等）は監査ログとして記録されます：

- 操作を行った管理者のユーザID
- 操作を行った日時（ISO 8601形式）
- 操作の種類（CREATE_PLAN、UPDATE_STATUS等）
- 操作の対象（プランID）
- 操作の内容（変更前と変更後の値）
- 操作を行ったIPアドレス

### エラーレスポンス形式

すべてのエラーレスポンスは、以下の形式で返されます：

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "エラーの説明",
    "details": {
      "field": "エラーが発生したフィールド名（該当する場合）",
      "reason": "詳細な理由"
    }
  }
}
```

### 共通HTTPステータスコード

| ステータスコード          | 説明                                               |
| ------------------------- | -------------------------------------------------- |
| 200 OK                    | リクエストが成功しました                           |
| 201 Created               | リソースの作成が成功しました                       |
| 400 Bad Request           | リクエストの形式が不正です                         |
| 401 Unauthorized          | 認証に失敗しました                                 |
| 403 Forbidden             | 認可に失敗しました（管理者権限がありません）       |
| 404 Not Found             | 指定されたリソースが見つかりません                 |
| 409 Conflict              | リソースの競合が発生しました（例：内部名称の重複） |
| 500 Internal Server Error | サーバー内部エラーが発生しました                   |

---

## 1. プラン一覧取得

### エンドポイント

```
GET /admin/billing/plans
```

### 説明

システムに登録されているすべてのプランの一覧を取得します。検索・絞り込み・ソート・ページネーション機能をサポートします。

### クエリパラメータ

| パラメータ名  | 型      | 必須 | デフォルト値 | 説明                                                                                                        |
| ------------- | ------- | ---- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| page          | integer | 任意 | 1            | ページ番号（1から開始）                                                                                     |
| limit         | integer | 任意 | 20           | 1ページあたりの表示件数（最大100）                                                                          |
| sort_by       | string  | 任意 | created_at   | ソート対象のフィールド<br>- `created_at`: 作成日時<br>- `internal_name`: 内部名称<br>- `status`: ステータス |
| sort_order    | string  | 任意 | desc         | ソート順序<br>- `asc`: 昇順<br>- `desc`: 降順                                                               |
| platform_type | string  | 任意 | -            | プラットフォーム種別による絞り込み<br>- `stripe`<br>- `apple`<br>- `google`<br>- `internal`                 |
| status        | string  | 任意 | -            | ステータスによる絞り込み<br>- `active`<br>- `closed_to_new`<br>- `deprecated`                               |
| search        | string  | 任意 | -            | 検索キーワード（内部名称、表示名で部分一致検索）                                                            |

### レスポンス形式

```json
{
  "plans": [
    {
      "plan_id": "123e4567-e89b-12d3-a456-426614174000",
      "internal_name": "standard_2025_jan_stripe",
      "display_name": "Standardプラン",
      "platform_type": "stripe",
      "status": "active",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "current_page": 1,
    "total_pages": 5,
    "total_count": 100,
    "limit": 20,
    "has_next": true,
    "has_previous": false
  },
  "statistics": {
    "total_plans": 100,
    "active_plans": 80,
    "closed_to_new_plans": 15,
    "deprecated_plans": 5
  }
}
```

### レスポンスフィールド説明

#### plans配列

| フィールド名  | 型                | 説明                 |
| ------------- | ----------------- | -------------------- |
| plan_id       | string (UUID)     | プランID             |
| internal_name | string            | 内部名称             |
| display_name  | string            | 表示名               |
| platform_type | string            | プラットフォーム種別 |
| status        | string            | ステータス           |
| created_at    | string (ISO 8601) | 作成日時             |

#### pagination

| フィールド名 | 型      | 説明                    |
| ------------ | ------- | ----------------------- |
| current_page | integer | 現在のページ番号        |
| total_pages  | integer | 総ページ数              |
| total_count  | integer | 総レコード数            |
| limit        | integer | 1ページあたりの表示件数 |
| has_next     | boolean | 次のページが存在するか  |
| has_previous | boolean | 前のページが存在するか  |

#### statistics

| フィールド名        | 型      | 説明                        |
| ------------------- | ------- | --------------------------- |
| total_plans         | integer | 全プラン数                  |
| active_plans        | integer | active状態のプラン数        |
| closed_to_new_plans | integer | closed_to_new状態のプラン数 |
| deprecated_plans    | integer | deprecated状態のプラン数    |

### エラーレスポンス例

#### 400 Bad Request - 不正なパラメータ

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "無効なパラメータが指定されました",
    "details": {
      "field": "sort_by",
      "reason": "sort_byには 'created_at', 'internal_name', 'status' のいずれかを指定してください"
    }
  }
}
```

### 備考

- `search`パラメータは、内部名称と表示名の両方に対して部分一致検索を行います
- `platform_type`と`status`の絞り込みは、AND条件で適用されます
- `limit`パラメータは最大100までの値を受け付けます。それを超える値が指定された場合は、100として扱われます
- 統計情報は、絞り込み条件が適用される前の全プランを対象に計算されます

---

## 2. プラン詳細取得

### エンドポイント

```
GET /admin/billing/plans/{plan_id}
```

### 説明

指定されたプランIDの詳細情報を取得します。

### パスパラメータ

| パラメータ名 | 型            | 必須 | 説明     |
| ------------ | ------------- | ---- | -------- |
| plan_id      | string (UUID) | 必須 | プランID |

### レスポンス形式

```json
{
  "plan_id": "123e4567-e89b-12d3-a456-426614174000",
  "internal_name": "standard_2025_jan_stripe",
  "display_name": "Standardプラン",
  "description": "モデルAとBに無制限アクセス。モデルCは月400回まで利用可能。",
  "platform_type": "stripe",
  "platform_product_id": "price_1234567890",
  "permissions": {
    "features": ["feature_a", "feature_b", "feature_c"],
    "limits": {
      "model_a": {
        "type": "unlimited"
      },
      "model_b": {
        "type": "daily",
        "count": 100
      },
      "model_c": {
        "type": "monthly",
        "count": 400
      }
    }
  },
  "status": "active",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z"
}
```

### レスポンスフィールド説明

| フィールド名        | 型                | 説明                                           |
| ------------------- | ----------------- | ---------------------------------------------- |
| plan_id             | string (UUID)     | プランID                                       |
| internal_name       | string            | 内部名称                                       |
| display_name        | string            | 表示名                                         |
| description         | string / null     | 説明（任意のため、未設定の場合はnull）         |
| platform_type       | string            | プラットフォーム種別                           |
| platform_product_id | string / null     | プラットフォーム商品ID（internalの場合はnull） |
| permissions         | object            | 権限・制限定義（JSON形式）                     |
| status              | string            | ステータス                                     |
| created_at          | string (ISO 8601) | 作成日時                                       |
| updated_at          | string (ISO 8601) | 最終更新日時                                   |

### エラーレスポンス例

#### 404 Not Found - プランが存在しない

```json
{
  "error": {
    "code": "PLAN_NOT_FOUND",
    "message": "指定されたプランが見つかりません",
    "details": {
      "plan_id": "123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

---

## 3. プラン作成

### エンドポイント

```
POST /admin/billing/plans
```

### 説明

新しいプランを作成します。作成されたプランは自動的に`active`ステータスになります。

### リクエストボディ形式

```json
{
  "internal_name": "standard_2025_jan_stripe",
  "display_name": "Standardプラン",
  "description": "モデルAとBに無制限アクセス。モデルCは月400回まで利用可能。",
  "platform_type": "stripe",
  "platform_product_id": "price_1234567890",
  "permissions": {
    "features": ["feature_a", "feature_b", "feature_c"],
    "limits": {
      "model_a": {
        "type": "unlimited"
      },
      "model_b": {
        "type": "daily",
        "count": 100
      },
      "model_c": {
        "type": "monthly",
        "count": 400
      }
    }
  }
}
```

### リクエストフィールド説明

| フィールド名        | 型     | 必須         | 制約                                              | 説明                                                                  |
| ------------------- | ------ | ------------ | ------------------------------------------------- | --------------------------------------------------------------------- |
| internal_name       | string | 必須         | 最大255文字、重複不可                             | 内部名称                                                              |
| display_name        | string | 必須         | 最大255文字                                       | 表示名                                                                |
| description         | string | 任意         | -                                                 | 説明                                                                  |
| platform_type       | string | 必須         | `stripe`, `apple`, `google`, `internal`のいずれか | プラットフォーム種別                                                  |
| platform_product_id | string | 条件付き必須 | 最大255文字                                       | プラットフォーム商品ID<br>※ platform_typeが`internal`以外の場合は必須 |
| permissions         | object | 必須         | 有効なJSON形式                                    | 権限・制限定義                                                        |

### バリデーションルール

#### 1. 内部名称の重複チェック

- 既存のプランと同じ`internal_name`は使用できません
- 大文字・小文字を区別します

#### 2. プラットフォーム商品IDの形式チェック

- **Stripeの場合**: `price_`で始まる文字列
- **Appleの場合**: 逆ドメイン形式（例：`com.example.standard_monthly`）
- **Googleの場合**: アンダースコア含む形式（例：`standard_monthly`）
- **internalの場合**: 省略可能（未指定またはnull）

#### 3. 権限・制限定義（permissions）の構造チェック

- `features`フィールドが必須で、文字列の配列であること
- `limits`フィールドが必須で、オブジェクトであること
- `limits`内の各モデルは、以下の構造を持つこと：
  - `type`: `unlimited`, `daily`, `monthly`のいずれか（必須）
  - `count`: `type`が`unlimited`以外の場合は必須（正の整数）

### レスポンス形式（成功時）

HTTPステータスコード: `201 Created`

```json
{
  "plan_id": "123e4567-e89b-12d3-a456-426614174000",
  "internal_name": "standard_2025_jan_stripe",
  "display_name": "Standardプラン",
  "description": "モデルAとBに無制限アクセス。モデルCは月400回まで利用可能。",
  "platform_type": "stripe",
  "platform_product_id": "price_1234567890",
  "permissions": {
    "features": ["feature_a", "feature_b", "feature_c"],
    "limits": {
      "model_a": {
        "type": "unlimited"
      },
      "model_b": {
        "type": "daily",
        "count": 100
      },
      "model_c": {
        "type": "monthly",
        "count": 400
      }
    }
  },
  "status": "active",
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-01-15T10:30:00Z"
}
```

### エラーレスポンス例

#### 400 Bad Request - 必須フィールドが不足

```json
{
  "error": {
    "code": "MISSING_REQUIRED_FIELD",
    "message": "必須フィールドが不足しています",
    "details": {
      "field": "internal_name",
      "reason": "internal_nameは必須です"
    }
  }
}
```

#### 409 Conflict - 内部名称の重複

```json
{
  "error": {
    "code": "DUPLICATE_INTERNAL_NAME",
    "message": "この内部名称は既に使われています",
    "details": {
      "field": "internal_name",
      "value": "standard_2025_jan_stripe"
    }
  }
}
```

#### 400 Bad Request - 不正なJSON形式

```json
{
  "error": {
    "code": "INVALID_JSON_FORMAT",
    "message": "permissions フィールドのJSON形式が不正です",
    "details": {
      "field": "permissions",
      "reason": "features フィールドが必須です"
    }
  }
}
```

#### 400 Bad Request - プラットフォーム商品IDの形式エラー

```json
{
  "error": {
    "code": "INVALID_PLATFORM_PRODUCT_ID",
    "message": "プラットフォーム商品IDの形式が正しくありません",
    "details": {
      "field": "platform_product_id",
      "reason": "Stripeの場合は 'price_' で始まるIDを入力してください"
    }
  }
}
```

### 備考

- プラン作成時に自動的に`created_at`と`updated_at`が設定されます
- プランIDは自動的に生成されます（UUID v4形式）
- 作成されたプランは自動的に`active`ステータスになります
- 作成処理は監査ログに記録されます

---

## 4. プランステータス変更

### エンドポイント

```
PATCH /admin/billing/plans/{plan_id}/status
```

### 説明

既存のプランのステータスを変更します。ステータス遷移ルールに従って変更が行われます。

### パスパラメータ

| パラメータ名 | 型            | 必須 | 説明     |
| ------------ | ------------- | ---- | -------- |
| plan_id      | string (UUID) | 必須 | プランID |

### リクエストボディ形式

```json
{
  "new_status": "closed_to_new"
}
```

### リクエストフィールド説明

| フィールド名 | 型     | 必須 | 制約                                              | 説明               |
| ------------ | ------ | ---- | ------------------------------------------------- | ------------------ |
| new_status   | string | 必須 | `active`, `closed_to_new`, `deprecated`のいずれか | 変更後のステータス |

### ステータス遷移ルール

| 現在のステータス | 変更可能なステータス                  |
| ---------------- | ------------------------------------- |
| active           | closed_to_new                         |
| closed_to_new    | deprecated（契約者数が0人の場合のみ） |
| deprecated       | 変更不可                              |

**重要な制約**：

- `closed_to_new`から`deprecated`への変更は、現在の契約者数が0人の場合のみ可能です
- 逆方向への遷移（例：`closed_to_new`から`active`へ戻す）はできません

### レスポンス形式（成功時）

HTTPステータスコード: `200 OK`

```json
{
  "plan_id": "123e4567-e89b-12d3-a456-426614174000",
  "internal_name": "standard_2025_jan_stripe",
  "display_name": "Standardプラン",
  "status": "closed_to_new",
  "previous_status": "active",
  "updated_at": "2025-01-15T10:30:00Z",
  "updated_by": "admin_user_123"
}
```

### レスポンスフィールド説明

| フィールド名    | 型                | 説明                         |
| --------------- | ----------------- | ---------------------------- |
| plan_id         | string (UUID)     | プランID                     |
| internal_name   | string            | 内部名称                     |
| display_name    | string            | 表示名                       |
| status          | string            | 変更後のステータス           |
| previous_status | string            | 変更前のステータス           |
| updated_at      | string (ISO 8601) | 更新日時                     |
| updated_by      | string            | 更新を行った管理者のユーザID |

### エラーレスポンス例

#### 400 Bad Request - 不正なステータス遷移

```json
{
  "error": {
    "code": "INVALID_STATUS_TRANSITION",
    "message": "このステータス遷移は許可されていません",
    "details": {
      "current_status": "active",
      "requested_status": "deprecated",
      "allowed_statuses": ["closed_to_new"],
      "reason": "active から deprecated への直接遷移はできません"
    }
  }
}
```

#### 409 Conflict - 契約者が存在する

```json
{
  "error": {
    "code": "CANNOT_DEPRECATE_WITH_ACTIVE_SUBSCRIPTIONS",
    "message": "このプランには現在50人の契約者がいるため、廃止できません",
    "details": {
      "active_subscription_count": 50,
      "reason": "すべての契約が終了してから廃止してください"
    }
  }
}
```

#### 404 Not Found - プランが存在しない

```json
{
  "error": {
    "code": "PLAN_NOT_FOUND",
    "message": "指定されたプランが見つかりません",
    "details": {
      "plan_id": "123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

### 備考

- ステータス変更は監査ログに記録されます
- `updated_at`は自動的に更新されます
- ステータス変更時に、変更履歴テーブルにも記録が追加されます

---

## 5. プラン変更履歴取得

### エンドポイント

```
GET /admin/billing/plans/{plan_id}/history
```

### 説明

指定されたプランに対して行われた変更の履歴を取得します。

### パスパラメータ

| パラメータ名 | 型            | 必須 | 説明     |
| ------------ | ------------- | ---- | -------- |
| plan_id      | string (UUID) | 必須 | プランID |

### クエリパラメータ

| パラメータ名 | 型      | 必須 | デフォルト値 | 説明                               |
| ------------ | ------- | ---- | ------------ | ---------------------------------- |
| page         | integer | 任意 | 1            | ページ番号（1から開始）            |
| limit        | integer | 任意 | 20           | 1ページあたりの表示件数（最大100） |

### レスポンス形式

```json
{
  "plan_id": "123e4567-e89b-12d3-a456-426614174000",
  "history": [
    {
      "change_id": "hist_123e4567-e89b-12d3-a456-426614174001",
      "changed_at": "2025-01-15T10:30:00Z",
      "changed_by": "admin_user_123",
      "change_type": "STATUS_UPDATE",
      "change_summary": "ステータスをactiveからclosed_to_newに変更",
      "details": {
        "field": "status",
        "old_value": "active",
        "new_value": "closed_to_new"
      }
    },
    {
      "change_id": "hist_223e4567-e89b-12d3-a456-426614174002",
      "changed_at": "2025-01-01T00:00:00Z",
      "changed_by": "admin_user_456",
      "change_type": "PLAN_CREATED",
      "change_summary": "プランを作成",
      "details": null
    }
  ],
  "pagination": {
    "current_page": 1,
    "total_pages": 1,
    "total_count": 2,
    "limit": 20,
    "has_next": false,
    "has_previous": false
  }
}
```

### レスポンスフィールド説明

#### history配列

| フィールド名   | 型                | 説明                                                                                                                |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| change_id      | string (UUID)     | 変更履歴ID                                                                                                          |
| changed_at     | string (ISO 8601) | 変更日時                                                                                                            |
| changed_by     | string            | 変更を行った管理者のユーザID                                                                                        |
| change_type    | string            | 変更の種類<br>- `PLAN_CREATED`: プラン作成<br>- `STATUS_UPDATE`: ステータス更新<br>- `PLAN_UPDATED`: プラン情報更新 |
| change_summary | string            | 変更内容の要約                                                                                                      |
| details        | object / null     | 変更の詳細情報（該当する場合）                                                                                      |

#### details（STATUS_UPDATEの場合）

| フィールド名 | 型     | 説明                   |
| ------------ | ------ | ---------------------- |
| field        | string | 変更されたフィールド名 |
| old_value    | string | 変更前の値             |
| new_value    | string | 変更後の値             |

### エラーレスポンス例

#### 404 Not Found - プランが存在しない

```json
{
  "error": {
    "code": "PLAN_NOT_FOUND",
    "message": "指定されたプランが見つかりません",
    "details": {
      "plan_id": "123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

### 備考

- 変更履歴は新しい順に返されます（最新の変更が先頭）
- プラン作成時の履歴も含まれます
- 変更履歴は削除されず、永続的に保持されます

---

## 6. プラン契約状況取得

### エンドポイント

```
GET /admin/billing/plans/{plan_id}/subscriptions
```

### 説明

指定されたプランの現在の契約状況を取得します。契約者数の合計、契約種別ごとの内訳、プラットフォーム別の内訳、過去30日間の契約者数推移を含みます。

### パスパラメータ

| パラメータ名 | 型            | 必須 | 説明     |
| ------------ | ------------- | ---- | -------- |
| plan_id      | string (UUID) | 必須 | プランID |

### レスポンス形式

```json
{
  "plan_id": "123e4567-e89b-12d3-a456-426614174000",
  "total_subscribers": 320,
  "breakdown_by_source": {
    "subscription": 300,
    "trial": 15,
    "manual": 5,
    "default": 0,
    "campaign": 0
  },
  "breakdown_by_platform": {
    "stripe": 180,
    "apple": 80,
    "google": 40,
    "internal": 20
  },
  "trend": {
    "period": "last_30_days",
    "data_points": [
      {
        "date": "2025-01-01",
        "subscriber_count": 280
      },
      {
        "date": "2025-01-02",
        "subscriber_count": 285
      },
      {
        "date": "2025-01-30",
        "subscriber_count": 320
      }
    ]
  },
  "updated_at": "2025-01-30T23:59:59Z"
}
```

### レスポンスフィールド説明

| フィールド名          | 型                | 説明                     |
| --------------------- | ----------------- | ------------------------ |
| plan_id               | string (UUID)     | プランID                 |
| total_subscribers     | integer           | 現在の契約者数（合計）   |
| breakdown_by_source   | object            | 契約種別ごとの内訳       |
| breakdown_by_platform | object            | プラットフォーム別の内訳 |
| trend                 | object            | 契約者数の推移データ     |
| updated_at            | string (ISO 8601) | データの最終更新日時     |

#### breakdown_by_source

| フィールド名 | 型      | 説明                             |
| ------------ | ------- | -------------------------------- |
| subscription | integer | サブスクリプション経由での契約数 |
| trial        | integer | トライアルでの利用者数           |
| manual       | integer | 手動付与での利用者数             |
| default      | integer | デフォルトプランとしての適用数   |
| campaign     | integer | キャンペーン経由での適用数       |

#### breakdown_by_platform

| フィールド名 | 型      | 説明                                   |
| ------------ | ------- | -------------------------------------- |
| stripe       | integer | Stripe経由の契約数                     |
| apple        | integer | Apple経由の契約数                      |
| google       | integer | Google経由の契約数                     |
| internal     | integer | 課金プラットフォームを経由しない契約数 |

#### trend

| フィールド名 | 型     | 説明                               |
| ------------ | ------ | ---------------------------------- |
| period       | string | 集計期間（固定値：`last_30_days`） |
| data_points  | array  | 日次の契約者数データ               |

#### data_points配列の要素

| フィールド名     | 型                  | 説明                   |
| ---------------- | ------------------- | ---------------------- |
| date             | string (YYYY-MM-DD) | 日付                   |
| subscriber_count | integer             | その日時点での契約者数 |

### エラーレスポンス例

#### 404 Not Found - プランが存在しない

```json
{
  "error": {
    "code": "PLAN_NOT_FOUND",
    "message": "指定されたプランが見つかりません",
    "details": {
      "plan_id": "123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

### 備考

- `total_subscribers`は、`application_status`が`active`または`scheduled_termination`のユーザプラン適用レコードの数をカウントします
- `breakdown_by_source`の各値の合計は、`total_subscribers`と一致します
- `breakdown_by_platform`は、サブスクリプション経由の契約のみが対象です（トライアル、手動付与等は含まれません）
- `trend`のデータポイントは、過去30日間の各日の0時時点での契約者数を表します
- データは定期的に集計され、`updated_at`でデータの鮮度を確認できます

---

## 7. 内部名称重複チェック

### エンドポイント

```
GET /admin/billing/plans/check-name
```

### 説明

指定された内部名称が既に使用されているかをチェックします。プラン作成フォームでのリアルタイムバリデーションに使用されます。

### クエリパラメータ

| パラメータ名  | 型     | 必須 | 説明                   |
| ------------- | ------ | ---- | ---------------------- |
| internal_name | string | 必須 | チェック対象の内部名称 |

### レスポンス形式

#### 使用可能な場合

```json
{
  "internal_name": "standard_2025_feb_stripe",
  "available": true
}
```

#### 既に使用されている場合

```json
{
  "internal_name": "standard_2025_jan_stripe",
  "available": false,
  "conflicting_plan": {
    "plan_id": "123e4567-e89b-12d3-a456-426614174000",
    "display_name": "Standardプラン",
    "status": "active"
  }
}
```

### レスポンスフィールド説明

| フィールド名     | 型            | 説明                                       |
| ---------------- | ------------- | ------------------------------------------ |
| internal_name    | string        | チェック対象の内部名称                     |
| available        | boolean       | 使用可能かどうか                           |
| conflicting_plan | object / null | 競合するプランの情報（使用不可の場合のみ） |

#### conflicting_plan

| フィールド名 | 型            | 説明                       |
| ------------ | ------------- | -------------------------- |
| plan_id      | string (UUID) | 競合するプランのID         |
| display_name | string        | 競合するプランの表示名     |
| status       | string        | 競合するプランのステータス |

### エラーレスポンス例

#### 400 Bad Request - パラメータが不足

```json
{
  "error": {
    "code": "MISSING_REQUIRED_PARAMETER",
    "message": "必須パラメータが不足しています",
    "details": {
      "parameter": "internal_name",
      "reason": "internal_name パラメータは必須です"
    }
  }
}
```

### 備考

- このエンドポイントは、プラン作成フォームでのリアルタイムバリデーションに使用されます
- 内部名称のチェックは大文字・小文字を区別します
- `deprecated`ステータスのプランも重複チェックの対象に含まれます（既に廃止されたプランと同じ名前は使用できません）

---

## データベーステーブルとの対応関係

これらのAPIエンドポイントは、以下のデータベーステーブルと連携します：

### プランテーブル

APIエンドポイント1〜5、7が直接参照・更新するテーブルです。

- **参照**: GET /admin/billing/plans, GET /admin/billing/plans/{plan_id}, GET /admin/billing/plans/check-name
- **作成**: POST /admin/billing/plans
- **更新**: PATCH /admin/billing/plans/{plan_id}/status

### ユーザプラン適用テーブル

APIエンドポイント6が参照するテーブルです。

- **参照**: GET /admin/billing/plans/{plan_id}/subscriptions
  - `application_status`が`active`または`scheduled_termination`のレコードをカウント
  - `application_source`でグルーピングして内訳を取得

### サブスクリプションテーブル

APIエンドポイント6が参照するテーブルです。

- **参照**: GET /admin/billing/plans/{plan_id}/subscriptions
  - `platform_type`でグルーピングしてプラットフォーム別内訳を取得

### プラン変更履歴テーブル（新規）

APIエンドポイント4、5で使用される新しいテーブルです。

**テーブル名**: `plan_change_history`

**カラム定義**:

| カラム名       | データ型       | 制約                       | 説明                         |
| -------------- | -------------- | -------------------------- | ---------------------------- |
| change_id      | UUID           | 主キー                     | 変更履歴ID                   |
| plan_id        | UUID           | 外部キー（プランテーブル） | 変更対象のプランID           |
| changed_at     | タイムスタンプ | 必須                       | 変更日時                     |
| changed_by     | 文字列         | 必須                       | 変更を行った管理者のユーザID |
| change_type    | 文字列         | 必須                       | 変更の種類                   |
| change_summary | テキスト       | 必須                       | 変更内容の要約               |
| details        | JSON           | 任意                       | 変更の詳細情報               |

**インデックス**:

- plan_idによる検索（変更履歴取得時に使用）
- changed_atによる検索（時系列順の取得に使用）

---

## 実装の考慮事項

### 1. キャッシュ戦略

頻繁に参照されるデータはキャッシュすることで、パフォーマンスを向上させます：

- **プラン一覧の統計情報**（TTL: 5分）
  - 統計情報は完全一致でのみキャッシュヒット
- **プラン詳細情報**（TTL: 10分）
  - プランIDをキーとしてキャッシュ
  - ステータス変更時はキャッシュを無効化

### 2. データ整合性の保証

- **プランステータス変更時の契約者数チェック**:
  - `deprecated`への変更時は、トランザクション内でユーザプラン適用テーブルをクエリし、契約者数を確認
  - 契約者が存在する場合は、変更をロールバック

### 3. 監査ログの記録

すべての変更操作は、以下の情報を監査ログに記録します：

- 操作を行った管理者のユーザID（認証トークンから取得）
- 操作を行った日時（サーバー側で生成）
- 操作の種類（CREATE_PLAN、UPDATE_STATUS等）
- 操作の対象（プランID）
- 操作の内容（変更前と変更後の値）
- 操作を行ったIPアドレス（リクエストヘッダーから取得）

### 4. エラーハンドリングとリトライ

- **一時的なエラー（ネットワークエラー、タイムアウト等）**:
  - 自動的にリトライ（指数バックオフ、最大3回）
- **永続的なエラー（バリデーションエラー、権限エラー等）**:
  - リトライせず、即座にエラーレスポンスを返す

### 5. レート制限

管理者APIに対しても、不正利用を防止するためのレート制限を適用します：

- **プラン一覧取得、詳細取得、契約状況取得**: 1分あたり60リクエスト
- **プラン作成、ステータス変更**: 1分あたり10リクエスト
- **内部名称重複チェック**: 1分あたり30リクエスト

レート制限を超えた場合は、`429 Too Many Requests`エラーを返します。

---

## セキュリティ考慮事項

### 1. 認証・認可の多層防御

- **APIゲートウェイレベル**: 有効なセッショントークンまたはAPIキーの検証
- **アプリケーションレベル**: OpenFGAによる管理者権限の検証
- **データアクセスレベル**: RDBの外部キー制約による参照整合性の保証

### 2. 入力値の厳格なバリデーション

- すべての入力値に対して、型チェック、長さチェック、形式チェックを実施
- SQLインジェクション対策として、プリペアドステートメントを使用
- XSS対策として、出力時にエスケープ処理を実施

### 3. 機密情報の保護

- ログに機密情報（APIキー、トークン等）を出力しない
- エラーメッセージに内部実装の詳細を含めない

### 4. CORS設定

管理者APIは、特定のオリジンからのアクセスのみを許可します：

- 許可するオリジン: 管理者用Webアプリケーションのドメイン
- 許可するHTTPメソッド: GET, POST, PATCH
- クレデンシャルの送信: 許可（認証トークンを含むリクエストを許可）
