# サブスクリプション管理API仕様

## 概要

このドキュメントでは、管理者向け運用管理インターフェースのサブスクリプション管理ページが機能するために必要なAPIエンドポイントの仕様を定義します。

これらのAPIエンドポイントは、以下の機能を実現するために使用されます:

- サブスクリプション全体の統計情報取得
- サブスクリプション一覧の取得（検索・絞り込み・ソート機能付き）
- サブスクリプション詳細情報の取得（タブ別）
- 検証保留中サブスクリプションの承認・却下（個別および一括）
- レシート検証の再試行
- プラットフォームとの同期
- 請求書のダウンロード

---

## 共通仕様

### 認証・認可

すべてのエンドポイントは、以下の認証・認可要件を満たす必要があります:

1. **認証**: 有効なセッショントークンまたはAPIキーによる認証が必須です
2. **認可**: OpenFGAによる管理者権限の検証が必須です
   - 各リクエスト処理の開始時に、OpenFGAに対して「このユーザは管理者ですか?」と問い合わせます
   - 管理者権限がない場合は、`403 Forbidden`エラーを返します

### 監査ログ

すべての変更操作（承認、却下等）は監査ログとして記録されます:

- 操作を行った管理者のユーザID
- 操作を行った日時（ISO 8601形式）
- 操作の種類（APPROVE_SUBSCRIPTION、REJECT_SUBSCRIPTION等）
- 操作の対象（サブスクリプションID）
- 操作の内容（承認理由、却下理由等）
- 操作を行ったIPアドレス

### エラーレスポンス形式

すべてのエラーレスポンスは、以下の形式で返されます:

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
| 409 Conflict              | リソースの競合が発生しました                       |
| 500 Internal Server Error | サーバー内部エラーが発生しました                   |

---

## 1. サブスクリプション統計取得

### エンドポイント

```
GET /admin/billing/subscriptions/statistics
```

### 説明

サブスクリプション全体の統計情報を取得します。全体サマリー、プラットフォーム別、プラン別、ステータス別の内訳、および期間別推移データを含みます。

### クエリパラメータ

| パラメータ名 | 型      | 必須 | デフォルト値 | 説明                                                                                  |
| ------------ | ------- | ---- | ------------ | ------------------------------------------------------------------------------------- |
| period       | string  | 任意 | last_30_days | 推移グラフの表示期間<br>- `last_7_days`: 過去7日間<br>- `last_30_days`: 過去30日間<br>- `last_90_days`: 過去90日間<br>- `last_1_year`: 過去1年間 |

### レスポンス形式

```json
{
  "summary": {
    "active_subscriptions": 1250,
    "pending_verification_subscriptions": 15,
    "past_due_subscriptions": 8,
    "new_subscriptions_this_month": 120,
    "canceled_subscriptions_this_month": 25,
    "comparison_with_last_month": {
      "active_subscriptions_change": 95,
      "active_subscriptions_change_percentage": 8.2,
      "pending_verification_change": 5,
      "past_due_change": 2,
      "new_subscriptions_change": 15,
      "canceled_subscriptions_change": -5
    }
  },
  "breakdown_by_platform": {
    "stripe": {
      "active": 700,
      "pending_verification": 8,
      "past_due": 5,
      "canceled": 120
    },
    "apple": {
      "active": 350,
      "pending_verification": 5,
      "past_due": 2,
      "canceled": 60
    },
    "google": {
      "active": 200,
      "pending_verification": 2,
      "past_due": 1,
      "canceled": 40
    }
  },
  "breakdown_by_plan": [
    {
      "plan_id": "123e4567-e89b-12d3-a456-426614174000",
      "plan_name": "Standardプラン",
      "active": 800,
      "pending_verification": 10,
      "past_due": 5,
      "new_this_month": 80,
      "canceled_this_month": 15
    },
    {
      "plan_id": "223e4567-e89b-12d3-a456-426614174001",
      "plan_name": "Proプラン",
      "active": 450,
      "pending_verification": 5,
      "past_due": 3,
      "new_this_month": 40,
      "canceled_this_month": 10
    }
  ],
  "breakdown_by_status": {
    "active": 1250,
    "pending_verification": 15,
    "past_due": 8,
    "canceled": 220,
    "expired": 50
  },
  "trend": {
    "period": "last_30_days",
    "data_points": [
      {
        "date": "2025-01-01",
        "new_subscriptions": 4,
        "canceled_subscriptions": 1,
        "active_subscriptions": 1156
      },
      {
        "date": "2025-01-02",
        "new_subscriptions": 5,
        "canceled_subscriptions": 2,
        "active_subscriptions": 1159
      },
      {
        "date": "2025-01-30",
        "new_subscriptions": 6,
        "canceled_subscriptions": 1,
        "active_subscriptions": 1250
      }
    ]
  },
  "updated_at": "2025-01-30T23:59:59Z"
}
```

### レスポンスフィールド説明

#### summary

| フィールド名                       | 型      | 説明                           |
| ---------------------------------- | ------- | ------------------------------ |
| active_subscriptions               | integer | 有効なサブスクリプション総数   |
| pending_verification_subscriptions | integer | 検証保留中のサブスクリプション数 |
| past_due_subscriptions             | integer | 支払い失敗中のサブスクリプション数 |
| new_subscriptions_this_month       | integer | 今月の新規契約数               |
| canceled_subscriptions_this_month  | integer | 今月の解約数                   |
| comparison_with_last_month         | object  | 前月との比較データ             |

#### comparison_with_last_month

| フィールド名                            | 型      | 説明                                 |
| --------------------------------------- | ------- | ------------------------------------ |
| active_subscriptions_change             | integer | 有効なサブスクリプション数の増減     |
| active_subscriptions_change_percentage  | number  | 有効なサブスクリプション数の増減率(%) |
| pending_verification_change             | integer | 検証保留中のサブスクリプション数の増減 |
| past_due_change                         | integer | 支払い失敗中のサブスクリプション数の増減 |
| new_subscriptions_change                | integer | 新規契約数の増減                     |
| canceled_subscriptions_change           | integer | 解約数の増減                         |

#### breakdown_by_platform

各プラットフォーム（stripe、apple、google）ごとに以下のフィールドを含みます:

| フィールド名         | 型      | 説明                       |
| -------------------- | ------- | -------------------------- |
| active               | integer | 有効な契約数               |
| pending_verification | integer | 検証保留中の契約数         |
| past_due             | integer | 支払い失敗中の契約数       |
| canceled             | integer | キャンセル済みの契約数     |

#### breakdown_by_plan配列

| フィールド名         | 型            | 説明                       |
| -------------------- | ------------- | -------------------------- |
| plan_id              | string (UUID) | プランID                   |
| plan_name            | string        | プラン表示名               |
| active               | integer       | 有効な契約数               |
| pending_verification | integer       | 検証保留中の契約数         |
| past_due             | integer       | 支払い失敗中の契約数       |
| new_this_month       | integer       | 今月の新規契約数           |
| canceled_this_month  | integer       | 今月の解約数               |

#### breakdown_by_status

| フィールド名         | 型      | 説明                       |
| -------------------- | ------- | -------------------------- |
| active               | integer | 有効な契約数               |
| pending_verification | integer | 検証保留中の契約数         |
| past_due             | integer | 支払い失敗中の契約数       |
| canceled             | integer | キャンセル済みの契約数     |
| expired              | integer | 期限切れの契約数           |

#### trend

| フィールド名 | 型     | 説明                     |
| ------------ | ------ | ------------------------ |
| period       | string | 集計期間                 |
| data_points  | array  | 日次の統計データ         |

#### data_points配列の要素

| フィールド名           | 型                  | 説明                         |
| ---------------------- | ------------------- | ---------------------------- |
| date                   | string (YYYY-MM-DD) | 日付                         |
| new_subscriptions      | integer             | その日の新規契約数           |
| canceled_subscriptions | integer             | その日の解約数               |
| active_subscriptions   | integer             | その日時点での有効な契約数   |

### エラーレスポンス例

#### 400 Bad Request - 不正なパラメータ

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "無効なパラメータが指定されました",
    "details": {
      "field": "period",
      "reason": "periodには 'last_7_days', 'last_30_days', 'last_90_days', 'last_1_year' のいずれかを指定してください"
    }
  }
}
```

### 備考

- 統計情報は定期的に集計され、`updated_at`でデータの鮮度を確認できます
- キャッシュTTLは5分です
- 推移データは、`period`に応じてデータポイントが間引かれる場合があります（1年間の場合は週別）

---

## 2. サブスクリプション一覧取得

### エンドポイント

```
GET /admin/billing/subscriptions
```

### 説明

サブスクリプションの一覧を取得します。検索・絞り込み・ソート・ページネーション機能をサポートします。

### クエリパラメータ

| パラメータ名                | 型      | 必須 | デフォルト値 | 説明                                                                                           |
| --------------------------- | ------- | ---- | ------------ | ---------------------------------------------------------------------------------------------- |
| page                        | integer | 任意 | 1            | ページ番号（1から開始）                                                                        |
| limit                       | integer | 任意 | 20           | 1ページあたりの表示件数（最大100）                                                             |
| sort_by                     | string  | 任意 | created_at   | ソート対象のフィールド<br>- `created_at`: 作成日時<br>- `period_start`: 契約期間開始日時<br>- `period_end`: 契約期間終了日時 |
| sort_order                  | string  | 任意 | desc         | ソート順序<br>- `asc`: 昇順<br>- `desc`: 降順                                                  |
| subscription_id             | string  | 任意 | -            | サブスクリプションIDで検索（部分一致）                                                         |
| user_id                     | string  | 任意 | -            | ユーザIDで検索（部分一致）                                                                     |
| user_name                   | string  | 任意 | -            | ユーザ名で検索（部分一致）                                                                     |
| platform_type               | string  | 任意 | -            | プラットフォーム種別による絞り込み<br>- `stripe`<br>- `apple`<br>- `google`                    |
| platform_subscription_id    | string  | 任意 | -            | プラットフォーム側サブスクリプションIDで検索（部分一致）                                       |
| status                      | string  | 任意 | -            | ステータスによる絞り込み<br>- `active`<br>- `pending_verification`<br>- `past_due`<br>- `canceled`<br>- `expired` |
| plan_id                     | string  | 任意 | -            | プランIDによる絞り込み                                                                         |
| period_start_from           | string  | 任意 | -            | 契約期間開始日時の検索範囲（開始）（ISO 8601形式）                                             |
| period_start_to             | string  | 任意 | -            | 契約期間開始日時の検索範囲（終了）（ISO 8601形式）                                             |
| created_at_from             | string  | 任意 | -            | 作成日時の検索範囲（開始）（ISO 8601形式）                                                     |
| created_at_to               | string  | 任意 | -            | 作成日時の検索範囲（終了）（ISO 8601形式）                                                     |

### レスポンス形式

```json
{
  "subscriptions": [
    {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "user_id": "user_abc123",
      "user_name": "田中太郎",
      "plan_id": "123e4567-e89b-12d3-a456-426614174000",
      "plan_name": "Standardプラン",
      "platform_type": "stripe",
      "platform_subscription_id": "sub_1234567890",
      "status": "active",
      "period_start": "2025-01-01T00:00:00Z",
      "period_end": "2025-02-01T00:00:00Z",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "current_page": 1,
    "total_pages": 63,
    "total_count": 1250,
    "limit": 20,
    "has_next": true,
    "has_previous": false
  }
}
```

### レスポンスフィールド説明

#### subscriptions配列

| フィールド名              | 型                | 説明                           |
| ------------------------- | ----------------- | ------------------------------ |
| subscription_id           | string (UUID)     | サブスクリプションID           |
| user_id                   | string            | ユーザID                       |
| user_name                 | string            | ユーザ名（表示名またはメールアドレス） |
| plan_id                   | string (UUID)     | プランID                       |
| plan_name                 | string            | プラン表示名                   |
| platform_type             | string            | プラットフォーム種別           |
| platform_subscription_id  | string            | プラットフォーム側サブスクリプションID |
| status                    | string            | ステータス                     |
| period_start              | string (ISO 8601) | 契約期間開始日時               |
| period_end                | string (ISO 8601) | 契約期間終了日時               |
| created_at                | string (ISO 8601) | 作成日時                       |

#### pagination

| フィールド名 | 型      | 説明                    |
| ------------ | ------- | ----------------------- |
| current_page | integer | 現在のページ番号        |
| total_pages  | integer | 総ページ数              |
| total_count  | integer | 総レコード数            |
| limit        | integer | 1ページあたりの表示件数 |
| has_next     | boolean | 次のページが存在するか  |
| has_previous | boolean | 前のページが存在するか  |

### エラーレスポンス例

#### 400 Bad Request - 不正なパラメータ

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "無効なパラメータが指定されました",
    "details": {
      "field": "status",
      "reason": "statusには 'active', 'pending_verification', 'past_due', 'canceled', 'expired' のいずれかを指定してください"
    }
  }
}
```

### 備考

- 複数の検索条件は、AND条件で適用されます
- `subscription_id`、`user_id`、`user_name`、`platform_subscription_id`は部分一致検索です
- `limit`パラメータは最大100までの値を受け付けます。それを超える値が指定された場合は、100として扱われます

---

## 3. サブスクリプション基本情報取得

### エンドポイント

```
GET /admin/billing/subscriptions/{subscription_id}
```

### 説明

指定されたサブスクリプションIDの詳細情報を取得します。基本情報、ユーザ情報、プラン情報、期間と更新情報を含みます。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                 |
| --------------- | ------------- | ---- | -------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID |

### レスポンス形式

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "platform_subscription_id": "sub_1234567890",
  "status": "active",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z",
  "user": {
    "user_id": "user_abc123",
    "user_name": "田中太郎",
    "email": "tanaka@example.com",
    "registered_at": "2024-06-01T00:00:00Z",
    "total_subscriptions_count": 2
  },
  "plan": {
    "plan_id": "123e4567-e89b-12d3-a456-426614174000",
    "internal_name": "standard_2025_jan_stripe",
    "display_name": "Standardプラン",
    "platform_type": "stripe",
    "platform_product_id": "price_1234567890",
    "status": "active",
    "permissions": {
      "features": ["feature_a", "feature_b"],
      "limits": {
        "model_a": {
          "type": "unlimited"
        },
        "model_b": {
          "type": "monthly",
          "count": 400
        }
      }
    }
  },
  "period": {
    "current_period_start": "2025-01-01T00:00:00Z",
    "current_period_end": "2025-02-01T00:00:00Z",
    "next_billing_date": "2025-02-01T00:00:00Z",
    "cancel_at_period_end": false,
    "renewal_count": 5,
    "next_billing_amount": {
      "amount": 1980,
      "currency": "JPY"
    }
  }
}
```

### レスポンスフィールド説明

#### 基本情報

| フィールド名              | 型                | 説明                           |
| ------------------------- | ----------------- | ------------------------------ |
| subscription_id           | string (UUID)     | サブスクリプションID           |
| platform_subscription_id  | string            | プラットフォーム側サブスクリプションID |
| status                    | string            | ステータス                     |
| created_at                | string (ISO 8601) | 作成日時                       |
| updated_at                | string (ISO 8601) | 最終更新日時                   |

#### user

| フィールド名              | 型                | 説明                         |
| ------------------------- | ----------------- | ---------------------------- |
| user_id                   | string            | ユーザID                     |
| user_name                 | string            | ユーザ名                     |
| email                     | string            | メールアドレス               |
| registered_at             | string (ISO 8601) | ユーザ登録日時               |
| total_subscriptions_count | integer           | ユーザの全サブスクリプション数 |

#### plan

| フィールド名        | 型            | 説明                   |
| ------------------- | ------------- | ---------------------- |
| plan_id             | string (UUID) | プランID               |
| internal_name       | string        | プラン内部名称         |
| display_name        | string        | プラン表示名           |
| platform_type       | string        | プラットフォーム種別   |
| platform_product_id | string        | プラットフォーム商品ID |
| status              | string        | プランのステータス     |
| permissions         | object        | 権限・制限定義         |

#### period

| フィールド名          | 型                | 説明                                       |
| --------------------- | ----------------- | ------------------------------------------ |
| current_period_start  | string (ISO 8601) | 現在の期間開始日時                         |
| current_period_end    | string (ISO 8601) | 現在の期間終了日時                         |
| next_billing_date     | string (ISO 8601) | 次回更新予定日時                           |
| cancel_at_period_end  | boolean           | 期限終了時にキャンセルするか               |
| renewal_count         | integer           | これまでの更新回数                         |
| next_billing_amount   | object / null     | 次回請求予定金額（該当する場合）           |

#### next_billing_amount

| フィールド名 | 型      | 説明       |
| ------------ | ------- | ---------- |
| amount       | integer | 金額       |
| currency     | string  | 通貨コード |

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

---

## 4. サブスクリプションステータス履歴取得

### エンドポイント

```
GET /admin/billing/subscriptions/{subscription_id}/status-history
```

### 説明

指定されたサブスクリプションのステータス変更履歴を取得します。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                 |
| --------------- | ------------- | ---- | -------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID |

### クエリパラメータ

| パラメータ名 | 型      | 必須 | デフォルト値 | 説明                               |
| ------------ | ------- | ---- | ------------ | ---------------------------------- |
| page         | integer | 任意 | 1            | ページ番号（1から開始）            |
| limit        | integer | 任意 | 20           | 1ページあたりの表示件数（最大100） |

### レスポンス形式

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "history": [
    {
      "change_id": "hist_123e4567-e89b-12d3-a456-426614174001",
      "changed_at": "2025-01-15T10:30:00Z",
      "previous_status": "pending_verification",
      "new_status": "active",
      "change_reason": "管理者による手動承認",
      "details": {
        "changed_by_admin_id": "admin_user_123",
        "approval_note": "レシート検証が一時的なネットワークエラーで失敗していたため承認"
      }
    },
    {
      "change_id": "hist_223e4567-e89b-12d3-a456-426614174002",
      "changed_at": "2025-01-01T00:00:00Z",
      "previous_status": null,
      "new_status": "pending_verification",
      "change_reason": "ユーザによる購入",
      "details": {
        "event_id": "evt_1234567890"
      }
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

| フィールド名    | 型                | 説明                                                                                                                                   |
| --------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| change_id       | string (UUID)     | 変更履歴ID                                                                                                                             |
| changed_at      | string (ISO 8601) | 変更日時                                                                                                                               |
| previous_status | string / null     | 変更前のステータス（初回作成時はnull）                                                                                                 |
| new_status      | string            | 変更後のステータス                                                                                                                     |
| change_reason   | string            | 変更理由<br>- `ユーザによる購入`<br>- `Webhookイベント: 支払い成功`<br>- `Webhookイベント: 支払い失敗`<br>- `Webhookイベント: キャンセル`<br>- `管理者による手動承認`<br>- `管理者による手動却下`<br>- `定期同期処理による修正` |
| details         | object / null     | 変更の詳細情報（該当する場合）                                                                                                         |

#### details（内容は変更理由によって異なる）

管理者による手動操作の場合:

| フィールド名        | 型     | 説明                         |
| ------------------- | ------ | ---------------------------- |
| changed_by_admin_id | string | 操作を行った管理者のユーザID |
| approval_note       | string | 承認時の備考（任意）         |
| rejection_reason    | string | 却下理由（却下の場合）       |

Webhookイベントの場合:

| フィールド名 | 型     | 説明           |
| ------------ | ------ | -------------- |
| event_id     | string | イベントID     |

定期同期処理の場合:

| フィールド名       | 型     | 説明               |
| ------------------ | ------ | ------------------ |
| inconsistency_type | string | 不整合の種類       |
| platform_status    | string | プラットフォーム側のステータス |

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

### 備考

- 履歴は新しい順に返されます（最新の変更が先頭）
- 初回作成時の履歴も含まれます

---

## 5. サブスクリプション支払い・請求履歴取得

### エンドポイント

```
GET /admin/billing/subscriptions/{subscription_id}/payment-history
```

### 説明

指定されたサブスクリプションの支払いと請求の履歴を取得します。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                 |
| --------------- | ------------- | ---- | -------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID |

### クエリパラメータ

| パラメータ名 | 型      | 必須 | デフォルト値 | 説明                               |
| ------------ | ------- | ---- | ------------ | ---------------------------------- |
| page         | integer | 任意 | 1            | ページ番号（1から開始）            |
| limit        | integer | 任意 | 20           | 1ページあたりの表示件数（最大100） |

### レスポンス形式

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "payment_history": [
    {
      "payment_id": "pay_123e4567-e89b-12d3-a456-426614174001",
      "payment_date": "2025-01-01T00:00:00Z",
      "type": "payment_succeeded",
      "amount": {
        "amount": 1980,
        "currency": "JPY"
      },
      "status": "succeeded",
      "failure_reason": null,
      "platform_invoice_id": "in_1234567890",
      "invoice_pdf_url": "https://example.com/invoices/in_1234567890.pdf",
      "notes": null
    },
    {
      "payment_id": "pay_223e4567-e89b-12d3-a456-426614174002",
      "payment_date": "2025-02-01T00:00:00Z",
      "type": "payment_failed",
      "amount": {
        "amount": 1980,
        "currency": "JPY"
      },
      "status": "failed",
      "failure_reason": "カードの残高不足",
      "platform_invoice_id": "in_2234567890",
      "invoice_pdf_url": null,
      "notes": "Stripeが自動的に再試行します"
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

#### payment_history配列

| フィールド名        | 型                | 説明                                                                                        |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| payment_id          | string (UUID)     | 支払い履歴ID                                                                                |
| payment_date        | string (ISO 8601) | 支払い・請求発生日時                                                                        |
| type                | string            | 種類<br>- `payment_succeeded`: 支払い成功<br>- `payment_failed`: 支払い失敗<br>- `invoice_created`: 請求<br>- `refund`: 返金 |
| amount              | object            | 金額情報                                                                                    |
| status              | string            | ステータス<br>- `succeeded`: 成功<br>- `failed`: 失敗<br>- `pending`: 保留<br>- `refunded`: 返金済み |
| failure_reason      | string / null     | 支払い失敗理由（失敗の場合）                                                                |
| platform_invoice_id | string / null     | プラットフォーム側の請求ID                                                                  |
| invoice_pdf_url     | string / null     | 請求書PDFのURL（Stripe経由の場合、該当する場合）                                            |
| notes               | string / null     | 備考・追加情報                                                                              |

#### amount

| フィールド名 | 型      | 説明       |
| ------------ | ------- | ---------- |
| amount       | integer | 金額       |
| currency     | string  | 通貨コード |

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

### 備考

- 履歴は新しい順に返されます（最新の支払いが先頭）
- `invoice_pdf_url`は、Stripe経由のサブスクリプションで請求書が生成されている場合のみ含まれます

---

## 6. サブスクリプションレシート情報取得

### エンドポイント

```
GET /admin/billing/subscriptions/{subscription_id}/receipt
```

### 説明

指定されたサブスクリプションのレシート情報、検証結果、検証履歴を取得します。このエンドポイントは、ステータスが`pending_verification`または`rejected`のサブスクリプションに対してのみ利用可能です。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                 |
| --------------- | ------------- | ---- | -------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID |

### レスポンス形式

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "receipt": {
    "receipt_data": "{\"transaction_id\": \"1000000123456789\", ...}",
    "receipt_signature": "MIIUGAYJKoZIhvcNAQcCoIIUCTCCF...",
    "platform_type": "apple"
  },
  "verification": {
    "last_verification_result": "failed",
    "last_verification_date": "2025-01-15T10:30:00Z",
    "failure_reason": "ネットワークエラー: プラットフォームAPIに接続できませんでした",
    "error_code": "NETWORK_ERROR",
    "stack_trace": "Error: ECONNREFUSED\n  at TCPConnectWrap.afterConnect...",
    "retry_count": 3
  },
  "verification_history": [
    {
      "verification_id": "ver_123e4567-e89b-12d3-a456-426614174001",
      "verified_at": "2025-01-15T10:30:00Z",
      "result": "failed",
      "failure_reason": "ネットワークエラー: プラットフォームAPIに接続できませんでした"
    },
    {
      "verification_id": "ver_223e4567-e89b-12d3-a456-426614174002",
      "verified_at": "2025-01-15T08:00:00Z",
      "result": "failed",
      "failure_reason": "タイムアウト: プラットフォームAPIからの応答が時間内に返されませんでした"
    },
    {
      "verification_id": "ver_323e4567-e89b-12d3-a456-426614174003",
      "verified_at": "2025-01-15T06:00:00Z",
      "result": "failed",
      "failure_reason": "ネットワークエラー: プラットフォームAPIに接続できませんでした"
    }
  ],
  "cache": {
    "cache_exists": false,
    "cache_expires_at": null
  }
}
```

### レスポンスフィールド説明

#### receipt

| フィールド名      | 型     | 説明                           |
| ----------------- | ------ | ------------------------------ |
| receipt_data      | string | レシート本体（JSON文字列）     |
| receipt_signature | string | レシートの署名情報             |
| platform_type     | string | プラットフォーム種別           |

#### verification

| フィールド名             | 型                | 説明                           |
| ------------------------ | ----------------- | ------------------------------ |
| last_verification_result | string            | 最後に行った検証の結果<br>- `succeeded`: 成功<br>- `failed`: 失敗 |
| last_verification_date   | string (ISO 8601) | 最後に検証を試みた日時         |
| failure_reason           | string / null     | 検証失敗理由（失敗の場合）     |
| error_code               | string / null     | エラーコード（該当する場合）   |
| stack_trace              | string / null     | スタックトレース（失敗の場合） |
| retry_count              | integer           | 再試行回数                     |

#### verification_history配列

| フィールル名   | 型                | 説明                       |
| -------------- | ----------------- | -------------------------- |
| verification_id | string (UUID)     | 検証履歴ID                 |
| verified_at    | string (ISO 8601) | 検証日時                   |
| result         | string            | 検証結果                   |
| failure_reason | string / null     | 失敗理由（失敗の場合）     |

#### cache

| フィールド名     | 型                | 説明                           |
| ---------------- | ----------------- | ------------------------------ |
| cache_exists     | boolean           | キャッシュが存在するか         |
| cache_expires_at | string / null     | キャッシュの有効期限（ISO 8601形式） |

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

#### 400 Bad Request - レシート情報が利用不可

```json
{
  "error": {
    "code": "RECEIPT_INFO_NOT_AVAILABLE",
    "message": "このサブスクリプションにはレシート情報がありません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "status": "active",
      "reason": "レシート情報は、検証保留中または却下済みのサブスクリプションのみ利用可能です"
    }
  }
}
```

### 備考

- このエンドポイントは、`pending_verification`または`rejected`ステータスのサブスクリプションに対してのみ利用可能です
- `receipt_data`は大きなJSON文字列になる可能性があるため、フロントエンドで適切に展開/折りたたみ機能を実装してください
- 検証履歴は新しい順に返されます（最新の検証が先頭）

---

## 7. サブスクリプション操作履歴取得

### エンドポイント

```
GET /admin/billing/subscriptions/{subscription_id}/operation-history
```

### 説明

指定されたサブスクリプションに対して管理者が行った操作の履歴を取得します。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                 |
| --------------- | ------------- | ---- | -------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID |

### クエリパラメータ

| パラメータ名 | 型      | 必須 | デフォルト値 | 説明                               |
| ------------ | ------- | ---- | ------------ | ---------------------------------- |
| page         | integer | 任意 | 1            | ページ番号（1から開始）            |
| limit        | integer | 任意 | 20           | 1ページあたりの表示件数（最大100） |

### レスポンス形式

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "operations": [
    {
      "operation_id": "op_123e4567-e89b-12d3-a456-426614174001",
      "operated_at": "2025-01-15T10:30:00Z",
      "operated_by": {
        "admin_id": "admin_user_123",
        "admin_name": "管理者太郎"
      },
      "operation_type": "approve",
      "operation_summary": "サブスクリプションを承認",
      "operation_details": {
        "previous_status": "pending_verification",
        "new_status": "active",
        "note": "レシート検証が一時的なネットワークエラーで失敗していたため承認"
      }
    },
    {
      "operation_id": "op_223e4567-e89b-12d3-a456-426614174002",
      "operated_at": "2025-01-15T10:00:00Z",
      "operated_by": {
        "admin_id": "admin_user_123",
        "admin_name": "管理者太郎"
      },
      "operation_type": "revalidate",
      "operation_summary": "レシート検証を再試行",
      "operation_details": {
        "verification_result": "failed",
        "failure_reason": "ネットワークエラー"
      }
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

#### operations配列

| フィールド名       | 型                | 説明                                                                                                   |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------ |
| operation_id       | string (UUID)     | 操作履歴ID                                                                                             |
| operated_at        | string (ISO 8601) | 操作日時                                                                                               |
| operated_by        | object            | 操作を行った管理者の情報                                                                               |
| operation_type     | string            | 操作の種類<br>- `approve`: 承認<br>- `reject`: 却下<br>- `revalidate`: 再検証<br>- `sync`: プラットフォーム同期 |
| operation_summary  | string            | 操作の要約                                                                                             |
| operation_details  | object            | 操作の詳細情報                                                                                         |

#### operated_by

| フィールド名 | 型     | 説明               |
| ------------ | ------ | ------------------ |
| admin_id     | string | 管理者のユーザID   |
| admin_name   | string | 管理者の名前       |

#### operation_details（内容は操作種別によって異なる）

承認の場合:

| フィールド名    | 型     | 説明               |
| --------------- | ------ | ------------------ |
| previous_status | string | 変更前のステータス |
| new_status      | string | 変更後のステータス |
| note            | string | 承認時の備考       |

却下の場合:

| フィールド名      | 型     | 説明               |
| ----------------- | ------ | ------------------ |
| previous_status   | string | 変更前のステータス |
| new_status        | string | 変更後のステータス |
| rejection_reason  | string | 却下理由（選択）   |
| rejection_details | string | 却下理由（詳細）   |

再検証の場合:

| フィールド名       | 型     | 説明               |
| ------------------ | ------ | ------------------ |
| verification_result | string | 検証結果           |
| failure_reason     | string | 失敗理由（失敗の場合） |

プラットフォーム同期の場合:

| フィールド名       | 型     | 説明                   |
| ------------------ | ------ | ---------------------- |
| sync_result        | string | 同期結果               |
| changes_detected   | array  | 検出された変更の一覧   |

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

### 備考

- 操作履歴は新しい順に返されます（最新の操作が先頭）
- 管理者が行った操作のみが記録されます（自動処理は含まれません）

---

## 8. サブスクリプション承認

### エンドポイント

```
POST /admin/billing/subscriptions/{subscription_id}/approve
```

### 説明

検証保留中（`pending_verification`）のサブスクリプションを承認し、ユーザのプランを有効化します。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                 |
| --------------- | ------------- | ---- | -------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID |

### リクエストボディ形式

```json
{
  "note": "レシート検証が一時的なネットワークエラーで失敗していたため承認"
}
```

### リクエストフィールド説明

| フィールド名 | 型     | 必須 | 説明             |
| ------------ | ------ | ---- | ---------------- |
| note         | string | 任意 | 承認時の備考     |

### レスポンス形式（成功時）

HTTPステータスコード: `200 OK`

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "previous_status": "pending_verification",
  "new_status": "active",
  "approved_at": "2025-01-15T10:30:00Z",
  "approved_by": "admin_user_123",
  "user_plan_application_id": "upa_123e4567-e89b-12d3-a456-426614174000",
  "notification_sent": true
}
```

### レスポンスフィールド説明

| フィールド名              | 型                | 説明                           |
| ------------------------- | ----------------- | ------------------------------ |
| subscription_id           | string (UUID)     | サブスクリプションID           |
| previous_status           | string            | 承認前のステータス             |
| new_status                | string            | 承認後のステータス             |
| approved_at               | string (ISO 8601) | 承認日時                       |
| approved_by               | string            | 承認を行った管理者のユーザID   |
| user_plan_application_id  | string (UUID)     | 作成されたユーザプラン適用ID   |
| notification_sent         | boolean           | ユーザへの通知が送信されたか   |

### 承認時の処理

システムは以下の処理を自動的に実行します:

1. サブスクリプションのステータスを`pending_verification`から`active`に変更
2. ユーザプラン適用テーブルに新しいレコードを作成（プランを適用）
3. OpenFGAに権限を登録（ユーザがプランの機能を使えるようにする）
4. 利用回数カウンターを初期化
5. ユーザに「サブスクリプションが有効になりました」という通知を送信
6. 操作を監査ログに記録

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

#### 400 Bad Request - 既に承認済み

```json
{
  "error": {
    "code": "ALREADY_APPROVED",
    "message": "このサブスクリプションは既に承認されています",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "current_status": "active"
    }
  }
}
```

#### 400 Bad Request - 承認できないステータス

```json
{
  "error": {
    "code": "INVALID_STATUS_FOR_APPROVAL",
    "message": "このステータスのサブスクリプションは承認できません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "current_status": "rejected",
      "reason": "承認できるのは pending_verification ステータスのサブスクリプションのみです"
    }
  }
}
```

### 備考

- 承認操作は監査ログに詳細に記録されます
- 承認後、ユーザには自動的に通知が送られます
- OpenFGAへの権限登録が失敗した場合は、処理全体がロールバックされます

---

## 9. サブスクリプション却下

### エンドポイント

```
POST /admin/billing/subscriptions/{subscription_id}/reject
```

### 説明

検証保留中（`pending_verification`）のサブスクリプションを却下します。却下されたサブスクリプションでは、ユーザにプランが適用されません。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                 |
| --------------- | ------------- | ---- | -------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID |

### リクエストボディ形式

```json
{
  "rejection_reason": "invalid_receipt",
  "rejection_details": "プラットフォーム側に問い合わせた結果、このレシートは存在しないことが確認されました"
}
```

### リクエストフィールド説明

| フィールド名      | 型     | 必須 | 説明                                                                                           |
| ----------------- | ------ | ---- | ---------------------------------------------------------------------------------------------- |
| rejection_reason  | string | 必須 | 却下理由（選択）<br>- `invalid_receipt`: レシートが無効<br>- `invalid_signature`: レシートの署名が不正<br>- `duplicate_receipt`: 重複したレシート<br>- `other`: その他 |
| rejection_details | string | 任意 | 却下理由の詳細説明                                                                             |

### レスポンス形式（成功時）

HTTPステータスコード: `200 OK`

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "previous_status": "pending_verification",
  "new_status": "rejected",
  "rejected_at": "2025-01-15T10:30:00Z",
  "rejected_by": "admin_user_123",
  "rejection_reason": "invalid_receipt",
  "rejection_details": "プラットフォーム側に問い合わせた結果、このレシートは存在しないことが確認されました",
  "notification_sent": true
}
```

### レスポンスフィールド説明

| フィールド名      | 型                | 説明                         |
| ----------------- | ----------------- | ---------------------------- |
| subscription_id   | string (UUID)     | サブスクリプションID         |
| previous_status   | string            | 却下前のステータス           |
| new_status        | string            | 却下後のステータス           |
| rejected_at       | string (ISO 8601) | 却下日時                     |
| rejected_by       | string            | 却下を行った管理者のユーザID |
| rejection_reason  | string            | 却下理由（選択）             |
| rejection_details | string / null     | 却下理由の詳細説明           |
| notification_sent | boolean           | ユーザへの通知が送信されたか |

### 却下時の処理

システムは以下の処理を自動的に実行します:

1. サブスクリプションのステータスを`pending_verification`から`rejected`に変更
2. 却下理由と却下を実行した管理者の情報を記録
3. ユーザに「サブスクリプション契約を確認できませんでした」という通知を送信（問い合わせ先などの案内を含む）
4. 操作を監査ログに記録

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

#### 400 Bad Request - 却下できないステータス

```json
{
  "error": {
    "code": "INVALID_STATUS_FOR_REJECTION",
    "message": "このステータスのサブスクリプションは却下できません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "current_status": "active",
      "reason": "却下できるのは pending_verification ステータスのサブスクリプションのみです"
    }
  }
}
```

#### 400 Bad Request - 必須フィールドが不足

```json
{
  "error": {
    "code": "MISSING_REQUIRED_FIELD",
    "message": "必須フィールドが不足しています",
    "details": {
      "field": "rejection_reason",
      "reason": "rejection_reasonは必須です"
    }
  }
}
```

### 備考

- 却下操作は監査ログに詳細に記録されます
- 却下後、ユーザには自動的に通知が送られます
- 却下されたサブスクリプションは、後から承認することはできません

---

## 10. サブスクリプション一括承認

### エンドポイント

```
POST /admin/billing/subscriptions/bulk-approve
```

### 説明

複数の検証保留中（`pending_verification`）のサブスクリプションを一括で承認します。プラットフォーム側の一時的な障害により、多数のレシート検証が失敗した場合などに使用します。

### リクエストボディ形式

```json
{
  "subscription_ids": [
    "sub_123e4567-e89b-12d3-a456-426614174000",
    "sub_223e4567-e89b-12d3-a456-426614174001",
    "sub_323e4567-e89b-12d3-a456-426614174002"
  ],
  "note": "Stripe APIの一時的な障害により検証失敗したため一括承認"
}
```

### リクエストフィールド説明

| フィールド名     | 型              | 必須 | 制約                      | 説明                       |
| ---------------- | --------------- | ---- | ------------------------- | -------------------------- |
| subscription_ids | array (string)  | 必須 | 最大100件、重複不可       | 承認するサブスクリプションIDの配列 |
| note             | string          | 任意 | -                         | 一括承認の理由や備考       |

### レスポンス形式（成功時）

HTTPステータスコード: `200 OK`

```json
{
  "total_requested": 3,
  "succeeded": 3,
  "failed": 0,
  "results": [
    {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "status": "succeeded",
      "user_plan_application_id": "upa_123e4567-e89b-12d3-a456-426614174000"
    },
    {
      "subscription_id": "sub_223e4567-e89b-12d3-a456-426614174001",
      "status": "succeeded",
      "user_plan_application_id": "upa_223e4567-e89b-12d3-a456-426614174001"
    },
    {
      "subscription_id": "sub_323e4567-e89b-12d3-a456-426614174002",
      "status": "succeeded",
      "user_plan_application_id": "upa_323e4567-e89b-12d3-a456-426614174002"
    }
  ],
  "approved_at": "2025-01-15T10:30:00Z",
  "approved_by": "admin_user_123"
}
```

### レスポンスフィールド説明

| フィールド名    | 型                | 説明                         |
| --------------- | ----------------- | ---------------------------- |
| total_requested | integer           | リクエストされた総数         |
| succeeded       | integer           | 成功した件数                 |
| failed          | integer           | 失敗した件数                 |
| results         | array             | 各サブスクリプションの処理結果 |
| approved_at     | string (ISO 8601) | 一括承認の実行日時           |
| approved_by     | string            | 承認を行った管理者のユーザID |

#### results配列

| フィールド名             | 型            | 説明                                       |
| ------------------------ | ------------- | ------------------------------------------ |
| subscription_id          | string (UUID) | サブスクリプションID                       |
| status                   | string        | 処理結果<br>- `succeeded`: 成功<br>- `failed`: 失敗 |
| user_plan_application_id | string / null | 作成されたユーザプラン適用ID（成功の場合） |
| error_code               | string / null | エラーコード（失敗の場合）                 |
| error_message            | string / null | エラーメッセージ（失敗の場合）             |

### エラーレスポンス例

#### 400 Bad Request - リクエストが不正

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "リクエストが不正です",
    "details": {
      "field": "subscription_ids",
      "reason": "subscription_idsは最大100件までです"
    }
  }
}
```

#### 400 Bad Request - 必須フィールドが不足

```json
{
  "error": {
    "code": "MISSING_REQUIRED_FIELD",
    "message": "必須フィールドが不足しています",
    "details": {
      "field": "subscription_ids",
      "reason": "subscription_idsは必須です"
    }
  }
}
```

### 部分的に失敗した場合のレスポンス例

```json
{
  "total_requested": 3,
  "succeeded": 2,
  "failed": 1,
  "results": [
    {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "status": "succeeded",
      "user_plan_application_id": "upa_123e4567-e89b-12d3-a456-426614174000"
    },
    {
      "subscription_id": "sub_223e4567-e89b-12d3-a456-426614174001",
      "status": "succeeded",
      "user_plan_application_id": "upa_223e4567-e89b-12d3-a456-426614174001"
    },
    {
      "subscription_id": "sub_323e4567-e89b-12d3-a456-426614174002",
      "status": "failed",
      "user_plan_application_id": null,
      "error_code": "ALREADY_APPROVED",
      "error_message": "このサブスクリプションは既に承認されています"
    }
  ],
  "approved_at": "2025-01-15T10:30:00Z",
  "approved_by": "admin_user_123"
}
```

### 備考

- 一度に承認できる数は最大100件までです
- 各サブスクリプションは個別に処理されるため、一部が失敗しても他は成功します
- すべての処理は監査ログに記録されます
- 処理には時間がかかる場合があるため、タイムアウト設定を適切に行ってください

---

## 11. サブスクリプション一括却下

### エンドポイント

```
POST /admin/billing/subscriptions/bulk-reject
```

### 説明

複数の検証保留中（`pending_verification`）のサブスクリプションを一括で却下します。明らかに不正なレシートが大量に送られてきた場合などに使用します。

### リクエストボディ形式

```json
{
  "subscription_ids": [
    "sub_123e4567-e89b-12d3-a456-426614174000",
    "sub_223e4567-e89b-12d3-a456-426614174001",
    "sub_323e4567-e89b-12d3-a456-426614174002"
  ],
  "rejection_reason": "invalid_receipt",
  "rejection_details": "不正なレシートのパターンに一致したため一括却下"
}
```

### リクエストフィールド説明

| フィールド名      | 型             | 必須 | 制約                                                                                                   | 説明                           |
| ----------------- | -------------- | ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------ |
| subscription_ids  | array (string) | 必須 | 最大100件、重複不可                                                                                    | 却下するサブスクリプションIDの配列 |
| rejection_reason  | string         | 必須 | `invalid_receipt`, `invalid_signature`, `duplicate_receipt`, `other`のいずれか                         | すべてのサブスクリプションに共通する却下理由 |
| rejection_details | string         | 任意 | -                                                                                                      | 却下理由の詳細説明             |

### レスポンス形式（成功時）

HTTPステータスコード: `200 OK`

```json
{
  "total_requested": 3,
  "succeeded": 3,
  "failed": 0,
  "results": [
    {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "status": "succeeded"
    },
    {
      "subscription_id": "sub_223e4567-e89b-12d3-a456-426614174001",
      "status": "succeeded"
    },
    {
      "subscription_id": "sub_323e4567-e89b-12d3-a456-426614174002",
      "status": "succeeded"
    }
  ],
  "rejected_at": "2025-01-15T10:30:00Z",
  "rejected_by": "admin_user_123",
  "rejection_reason": "invalid_receipt",
  "rejection_details": "不正なレシートのパターンに一致したため一括却下"
}
```

### レスポンスフィールド説明

| フィールド名      | 型                | 説明                         |
| ----------------- | ----------------- | ---------------------------- |
| total_requested   | integer           | リクエストされた総数         |
| succeeded         | integer           | 成功した件数                 |
| failed            | integer           | 失敗した件数                 |
| results           | array             | 各サブスクリプションの処理結果 |
| rejected_at       | string (ISO 8601) | 一括却下の実行日時           |
| rejected_by       | string            | 却下を行った管理者のユーザID |
| rejection_reason  | string            | 却下理由（選択）             |
| rejection_details | string / null     | 却下理由の詳細説明           |

#### results配列

| フィールド名    | 型            | 説明                                       |
| --------------- | ------------- | ------------------------------------------ |
| subscription_id | string (UUID) | サブスクリプションID                       |
| status          | string        | 処理結果<br>- `succeeded`: 成功<br>- `failed`: 失敗 |
| error_code      | string / null | エラーコード（失敗の場合）                 |
| error_message   | string / null | エラーメッセージ（失敗の場合）             |

### エラーレスポンス例

#### 400 Bad Request - リクエストが不正

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "リクエストが不正です",
    "details": {
      "field": "subscription_ids",
      "reason": "subscription_idsは最大100件までです"
    }
  }
}
```

#### 400 Bad Request - 必須フィールドが不足

```json
{
  "error": {
    "code": "MISSING_REQUIRED_FIELD",
    "message": "必須フィールドが不足しています",
    "details": {
      "field": "rejection_reason",
      "reason": "rejection_reasonは必須です"
    }
  }
}
```

### 備考

- 一度に却下できる数は最大100件までです
- 各サブスクリプションは個別に処理されるため、一部が失敗しても他は成功します
- すべての処理は監査ログに記録されます
- 却下されたユーザには個別に通知が送られます

---

## 12. サブスクリプション再検証

### エンドポイント

```
POST /admin/billing/subscriptions/{subscription_id}/revalidate
```

### 説明

検証保留中（`pending_verification`）のサブスクリプションに対して、レシート検証を手動で再試行します。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                 |
| --------------- | ------------- | ---- | -------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID |

### リクエストボディ形式

```json
{}
```

リクエストボディは空のオブジェクトです。

### レスポンス形式（成功時）

#### 検証成功の場合

HTTPステータスコード: `200 OK`

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "verification_result": "succeeded",
  "previous_status": "pending_verification",
  "new_status": "active",
  "verified_at": "2025-01-15T10:30:00Z",
  "user_plan_application_id": "upa_123e4567-e89b-12d3-a456-426614174000",
  "message": "レシート検証が成功し、サブスクリプションが自動的に承認されました"
}
```

#### 検証失敗の場合

HTTPステータスコード: `200 OK`

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "verification_result": "failed",
  "previous_status": "pending_verification",
  "new_status": "pending_verification",
  "verified_at": "2025-01-15T10:30:00Z",
  "failure_reason": "ネットワークエラー: プラットフォームAPIに接続できませんでした",
  "retry_count": 4,
  "message": "レシート検証が失敗しました。手動で承認または却下してください"
}
```

### レスポンスフィールド説明

| フィールド名             | 型                | 説明                                       |
| ------------------------ | ----------------- | ------------------------------------------ |
| subscription_id          | string (UUID)     | サブスクリプションID                       |
| verification_result      | string            | 検証結果<br>- `succeeded`: 成功<br>- `failed`: 失敗 |
| previous_status          | string            | 検証前のステータス                         |
| new_status               | string            | 検証後のステータス                         |
| verified_at              | string (ISO 8601) | 検証実行日時                               |
| user_plan_application_id | string / null     | 作成されたユーザプラン適用ID（成功の場合） |
| failure_reason           | string / null     | 検証失敗理由（失敗の場合）                 |
| retry_count              | integer / null    | 更新後の再試行回数（失敗の場合）           |
| message                  | string            | 実行結果のメッセージ                       |

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

#### 400 Bad Request - 再検証できないステータス

```json
{
  "error": {
    "code": "INVALID_STATUS_FOR_REVALIDATION",
    "message": "このステータスのサブスクリプションは再検証できません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "current_status": "active",
      "reason": "再検証できるのは pending_verification ステータスのサブスクリプションのみです"
    }
  }
}
```

### 備考

- 検証が成功した場合、サブスクリプションは自動的に承認され、ステータスが`active`になります
- 検証が失敗した場合、ステータスは`pending_verification`のまま維持されます
- 再検証操作は監査ログに記録されます
- 検証結果は検証履歴にも追加されます

---

## 13. サブスクリプションプラットフォーム同期

### エンドポイント

```
POST /admin/billing/subscriptions/{subscription_id}/sync
```

### 説明

課金プラットフォームに最新の状態を問い合わせ、ローカルのサブスクリプション情報を更新します。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                 |
| --------------- | ------------- | ---- | -------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID |

### リクエストボディ形式

```json
{}
```

リクエストボディは空のオブジェクトです。

### レスポンス形式（成功時）

HTTPステータスコード: `200 OK`

```json
{
  "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
  "sync_result": "succeeded",
  "synced_at": "2025-01-15T10:30:00Z",
  "changes_detected": [
    {
      "field": "status",
      "old_value": "active",
      "new_value": "canceled",
      "updated": true
    },
    {
      "field": "current_period_end",
      "old_value": "2025-02-01T00:00:00Z",
      "new_value": "2025-02-01T00:00:00Z",
      "updated": false
    }
  ],
  "message": "プラットフォームとの同期が完了しました。1件の変更を検出し、更新しました"
}
```

### レスポンスフィールド説明

| フィールド名     | 型                | 説明                                       |
| ---------------- | ----------------- | ------------------------------------------ |
| subscription_id  | string (UUID)     | サブスクリプションID                       |
| sync_result      | string            | 同期結果<br>- `succeeded`: 成功<br>- `failed`: 失敗 |
| synced_at        | string (ISO 8601) | 同期実行日時                               |
| changes_detected | array             | 検出された変更の一覧                       |
| message          | string            | 同期結果のメッセージ                       |

#### changes_detected配列

| フィールド名 | 型      | 説明                                 |
| ------------ | ------- | ------------------------------------ |
| field        | string  | 変更されたフィールド名               |
| old_value    | any     | ローカル側の値                       |
| new_value    | any     | プラットフォーム側の値               |
| updated      | boolean | ローカル側を更新したか               |

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

#### 500 Internal Server Error - プラットフォームAPIエラー

```json
{
  "error": {
    "code": "PLATFORM_API_ERROR",
    "message": "プラットフォームAPIとの通信に失敗しました",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "platform_type": "stripe",
      "reason": "ネットワークエラー"
    }
  }
}
```

### 備考

- 同期操作は監査ログに記録されます
- 同期時に検出された変更は、サブスクリプションステータス履歴にも記録されます
- プラットフォームAPIとの通信エラーが発生した場合は、適切なエラーメッセージが返されます

---

## 14. 請求書ダウンロード

### エンドポイント

```
GET /admin/billing/subscriptions/{subscription_id}/invoices/{invoice_id}
```

### 説明

Stripe経由のサブスクリプションの請求書PDFをダウンロードします。Apple/Google経由のサブスクリプションでは利用できません。

### パスパラメータ

| パラメータ名    | 型            | 必須 | 説明                         |
| --------------- | ------------- | ---- | ---------------------------- |
| subscription_id | string (UUID) | 必須 | サブスクリプションID         |
| invoice_id      | string        | 必須 | プラットフォーム側の請求ID   |

### レスポンス形式（成功時）

HTTPステータスコード: `200 OK`

Content-Type: `application/pdf`

レスポンスボディ: PDFファイルのバイナリデータ

### エラーレスポンス例

#### 404 Not Found - サブスクリプションが存在しない

```json
{
  "error": {
    "code": "SUBSCRIPTION_NOT_FOUND",
    "message": "指定されたサブスクリプションが見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000"
    }
  }
}
```

#### 404 Not Found - 請求書が存在しない

```json
{
  "error": {
    "code": "INVOICE_NOT_FOUND",
    "message": "指定された請求書が見つかりません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "invoice_id": "in_1234567890"
    }
  }
}
```

#### 400 Bad Request - プラットフォームが非対応

```json
{
  "error": {
    "code": "PLATFORM_NOT_SUPPORTED",
    "message": "このプラットフォームでは請求書のダウンロードはサポートされていません",
    "details": {
      "subscription_id": "sub_123e4567-e89b-12d3-a456-426614174000",
      "platform_type": "apple",
      "reason": "請求書のダウンロードはStripe経由のサブスクリプションのみ対応しています"
    }
  }
}
```

### 備考

- このエンドポイントは、Stripe経由のサブスクリプションのみ利用可能です
- Apple/Google経由のサブスクリプションでは、プラットフォーム側の請求情報へのリンクが提供されます
- ダウンロード操作は監査ログに記録されます

---

## データベーステーブルとの対応関係

これらのAPIエンドポイントは、以下のデータベーステーブルと連携します:

### サブスクリプションテーブル

APIエンドポイント1〜14のすべてが参照・更新するテーブルです。

- **参照**: GET /admin/billing/subscriptions/statistics, GET /admin/billing/subscriptions, GET /admin/billing/subscriptions/{subscription_id}
- **更新**: POST /admin/billing/subscriptions/{subscription_id}/approve, POST /admin/billing/subscriptions/{subscription_id}/reject, POST /admin/billing/subscriptions/bulk-approve, POST /admin/billing/subscriptions/bulk-reject, POST /admin/billing/subscriptions/{subscription_id}/revalidate, POST /admin/billing/subscriptions/{subscription_id}/sync

### ユーザプラン適用テーブル

承認時に新しいレコードを作成するテーブルです。

- **作成**: POST /admin/billing/subscriptions/{subscription_id}/approve, POST /admin/billing/subscriptions/bulk-approve, POST /admin/billing/subscriptions/{subscription_id}/revalidate（検証成功時）

### サブスクリプションステータス履歴テーブル（新規）

ステータス変更履歴を記録する新しいテーブルです。

**テーブル名**: `subscription_status_history`

**カラム定義**:

| カラム名        | データ型       | 制約                                   | 説明                         |
| --------------- | -------------- | -------------------------------------- | ---------------------------- |
| change_id       | UUID           | 主キー                                 | 変更履歴ID                   |
| subscription_id | UUID           | 外部キー（サブスクリプションテーブル） | サブスクリプションID         |
| changed_at      | タイムスタンプ | 必須                                   | 変更日時                     |
| previous_status | 文字列         | 任意                                   | 変更前のステータス           |
| new_status      | 文字列         | 必須                                   | 変更後のステータス           |
| change_reason   | テキスト       | 必須                                   | 変更理由                     |
| details         | JSON           | 任意                                   | 変更の詳細情報               |

**インデックス**:
- subscription_idによる検索（履歴取得時に使用）
- changed_atによる検索（時系列順の取得に使用）

- **作成**: すべてのステータス変更時に自動的に追加
- **参照**: GET /admin/billing/subscriptions/{subscription_id}/status-history

### サブスクリプション支払い履歴テーブル（新規）

支払いと請求の履歴を記録する新しいテーブルです。

**テーブル名**: `subscription_payment_history`

**カラム定義**:

| カラム名             | データ型       | 制約                                   | 説明                         |
| -------------------- | -------------- | -------------------------------------- | ---------------------------- |
| payment_id           | UUID           | 主キー                                 | 支払い履歴ID                 |
| subscription_id      | UUID           | 外部キー（サブスクリプションテーブル） | サブスクリプションID         |
| payment_date         | タイムスタンプ | 必須                                   | 支払い・請求発生日時         |
| type                 | 文字列         | 必須                                   | 種類                         |
| amount               | 整数           | 必須                                   | 金額                         |
| currency             | 文字列         | 必須                                   | 通貨コード                   |
| status               | 文字列         | 必須                                   | ステータス                   |
| failure_reason       | テキスト       | 任意                                   | 支払い失敗理由               |
| platform_invoice_id  | 文字列         | 任意                                   | プラットフォーム側の請求ID   |
| invoice_pdf_url      | テキスト       | 任意                                   | 請求書PDFのURL               |
| notes                | テキスト       | 任意                                   | 備考                         |

**インデックス**:
- subscription_idによる検索（履歴取得時に使用）
- payment_dateによる検索（時系列順の取得に使用）

- **作成**: Webhookイベント受信時、プラットフォーム同期時に自動的に追加
- **参照**: GET /admin/billing/subscriptions/{subscription_id}/payment-history

### サブスクリプションレシート情報テーブル（新規）

レシート検証情報を記録する新しいテーブルです。

**テーブル名**: `subscription_receipt_verification`

**カラム定義**:

| カラム名            | データ型       | 制約                                   | 説明                         |
| ------------------- | -------------- | -------------------------------------- | ---------------------------- |
| subscription_id     | UUID           | 主キー、外部キー（サブスクリプションテーブル） | サブスクリプションID |
| receipt_data        | TEXT           | 必須                                   | レシート本体                 |
| receipt_signature   | TEXT           | 任意                                   | レシートの署名情報           |
| last_verification_result | 文字列    | 必須                                   | 最後の検証結果               |
| last_verification_date | タイムスタンプ | 必須                                 | 最後の検証日時               |
| failure_reason      | テキスト       | 任意                                   | 検証失敗理由                 |
| error_code          | 文字列         | 任意                                   | エラーコード                 |
| stack_trace         | TEXT           | 任意                                   | スタックトレース             |
| retry_count         | 整数           | 必須、デフォルト0                      | 再試行回数                   |
| cache_expires_at    | タイムスタンプ | 任意                                   | キャッシュ有効期限           |

- **作成**: サブスクリプション作成時に同時に作成（レシート検証が必要な場合）
- **更新**: POST /admin/billing/subscriptions/{subscription_id}/revalidate
- **参照**: GET /admin/billing/subscriptions/{subscription_id}/receipt

### レシート検証履歴テーブル（新規）

レシート検証の履歴を記録する新しいテーブルです。

**テーブル名**: `receipt_verification_history`

**カラム定義**:

| カラム名        | データ型       | 制約                                   | 説明                         |
| --------------- | -------------- | -------------------------------------- | ---------------------------- |
| verification_id | UUID           | 主キー                                 | 検証履歴ID                   |
| subscription_id | UUID           | 外部キー（サブスクリプションテーブル） | サブスクリプションID         |
| verified_at     | タイムスタンプ | 必須                                   | 検証日時                     |
| result          | 文字列         | 必須                                   | 検証結果                     |
| failure_reason  | テキスト       | 任意                                   | 失敗理由                     |

**インデックス**:
- subscription_idによる検索（履歴取得時に使用）
- verified_atによる検索（時系列順の取得に使用）

- **作成**: レシート検証実行時に自動的に追加
- **参照**: GET /admin/billing/subscriptions/{subscription_id}/receipt（verification_historyフィールド）

### サブスクリプション操作履歴テーブル（新規）

管理者が行った操作の履歴を記録する新しいテーブルです。

**テーブル名**: `subscription_operation_history`

**カラム定義**:

| カラム名           | データ型       | 制約                                   | 説明                         |
| ------------------ | -------------- | -------------------------------------- | ---------------------------- |
| operation_id       | UUID           | 主キー                                 | 操作履歴ID                   |
| subscription_id    | UUID           | 外部キー（サブスクリプションテーブル） | サブスクリプションID         |
| operated_at        | タイムスタンプ | 必須                                   | 操作日時                     |
| operated_by        | 文字列         | 必須                                   | 操作を行った管理者のユーザID |
| operation_type     | 文字列         | 必須                                   | 操作の種類                   |
| operation_summary  | テキスト       | 必須                                   | 操作の要約                   |
| operation_details  | JSON           | 任意                                   | 操作の詳細情報               |

**インデックス**:
- subscription_idによる検索（履歴取得時に使用）
- operated_atによる検索（時系列順の取得に使用）

- **作成**: すべての管理者操作時に自動的に追加
- **参照**: GET /admin/billing/subscriptions/{subscription_id}/operation-history

---

## 実装の考慮事項

### 1. キャッシュ戦略

頻繁に参照されるデータはキャッシュすることで、パフォーマンスを向上させます:

- **サブスクリプション統計情報**（TTL: 5分）
  - 統計情報は完全一致でのみキャッシュヒット
  - `period`パラメータが異なる場合は別のキャッシュとして扱う
- **サブスクリプション基本情報**（TTL: 10分）
  - サブスクリプションIDをキーとしてキャッシュ
  - ステータス変更時、承認/却下時はキャッシュを無効化

### 2. データ整合性の保証

- **承認時のトランザクション処理**:
  - サブスクリプションステータス変更、ユーザプラン適用作成、OpenFGA権限登録、利用回数カウンター初期化は、すべて1つのトランザクション内で実行
  - いずれかが失敗した場合は、全体をロールバック
- **一括操作時のエラーハンドリング**:
  - 各サブスクリプションは個別のトランザクションで処理
  - 一部が失敗しても、他の処理は継続

### 3. 監査ログの記録

すべての変更操作は、以下の情報を監査ログに記録します:

- 操作を行った管理者のユーザID（認証トークンから取得）
- 操作を行った日時（サーバー側で生成）
- 操作の種類（APPROVE_SUBSCRIPTION、REJECT_SUBSCRIPTION等）
- 操作の対象（サブスクリプションID）
- 操作の内容（承認理由、却下理由等）
- 操作を行ったIPアドレス（リクエストヘッダーから取得）

### 4. エラーハンドリングとリトライ

- **一時的なエラー（ネットワークエラー、タイムアウト等）**:
  - 自動的にリトライ（指数バックオフ、最大3回）
  - プラットフォームAPIとの通信時に適用
- **永続的なエラー（バリデーションエラー、権限エラー等）**:
  - リトライせず、即座にエラーレスポンスを返す

### 5. レート制限

管理者APIに対しても、不正利用を防止するためのレート制限を適用します:

- **統計取得、一覧取得、詳細取得**: 1分あたり60リクエスト
- **承認、却下、再検証、同期**: 1分あたり10リクエスト
- **一括操作**: 1分あたり5リクエスト（処理負荷が高いため）

レート制限を超えた場合は、`429 Too Many Requests`エラーを返します。

### 6. 一括操作のパフォーマンス最適化

- **並列処理**: 一括操作では、各サブスクリプションの処理を並列で実行（ただし、データベースの負荷を考慮して並列度を制限）
- **バッチサイズ制限**: 最大100件までに制限し、それ以上の場合は複数回に分けて実行
- **進捗状況の返却**: WebSocket等を利用して、リアルタイムに進捗状況をクライアントに通知（推奨）

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

- ログに機密情報（レシート本体、署名情報等）を出力しない
- エラーメッセージに内部実装の詳細を含めない
- レシート情報は、検証保留中または却下済みのサブスクリプションに対してのみ公開

### 4. CORS設定

管理者APIは、特定のオリジンからのアクセスのみを許可します:

- 許可するオリジン: 管理者用Webアプリケーションのドメイン
- 許可するHTTPメソッド: GET, POST
- クレデンシャルの送信: 許可（認証トークンを含むリクエストを許可）

### 5. 一括操作の制限

一括操作は強力な機能であるため、特別な制限を設けます:

- 一度に処理できる数は最大100件まで
- レート制限を厳しく設定（1分あたり5リクエスト）
- すべての一括操作は詳細に監査ログに記録
