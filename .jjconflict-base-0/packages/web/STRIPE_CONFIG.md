# Stripe設定ガイド

## 必要な環境変数

フロントエンドアプリケーションでStripe決済機能を動作させるには、以下の環境変数を設定する必要があります。

### フロントエンド環境変数

`.env`ファイルまたはデプロイメント環境に以下を設定してください：

```bash
# Stripeのパブリッシャブルキー（公開可能なキー）
VITE_APP_STRIPE_PUBLISHABLE_KEY=pk_test_...またはpk_live_...

# ビリングAPI エンドポイント（既存）
VITE_APP_BILLING_API_ENDPOINT=https://your-billing-api-endpoint
```

### Stripeキーの取得方法

1. [Stripe Dashboard](https://dashboard.stripe.com)にログイン
2. 「開発者」→「APIキー」に移動
3. パブリッシャブルキー（pk_test_...またはpk_live_...）をコピー

⚠️ **重要な注意事項**:
- パブリッシャブルキー（pk_）は公開可能です
- シークレットキー（sk_）は絶対にフロントエンドに設置しないでください

## 実装された機能

### 1. プラン管理タブ
- **場所**: 設定モーダル内の「プランの管理」タブ
- **機能**:
  - 利用可能なプランの一覧表示
  - 現在のサブスクリプション状態の表示
  - プランの選択と購入

### 2. Stripe Checkout統合
- **コンポーネント**: `StripeCheckoutModal`
- **機能**:
  - Embedded Checkoutを使用した安全な支払いフォーム
  - モーダル内での支払い処理

### 3. 支払い完了処理
- **ページ**: `/billing/complete`
- **機能**:
  - セッション状態の確認
  - サブスクリプションのアクティベーション
  - 成功/エラーメッセージの表示

## APIエンドポイント

実装は以下のAPIエンドポイントを使用します（バックエンドで提供される想定）：

### プラン関連
- `GET /api/plans?platform=web` - 利用可能なプラン一覧の取得
- `POST /api/subscriptions/checkout-session` - Checkout Session作成
- `GET /api/subscriptions/checkout-session/{session_id}/status` - セッション状態確認
- `POST /api/subscriptions/activate-from-session` - サブスクリプションアクティベーション
- `GET /api/subscriptions/current` - 現在のサブスクリプション取得
- `POST /api/subscriptions/cancel` - サブスクリプションキャンセル

## 使用方法

1. 環境変数を設定
2. アプリケーションを起動: `npm run dev`
3. ユーザーメニューから設定を開く
4. 「プランの管理」タブを選択
5. プランを選択して購入

## テスト用クレジットカード

Stripeテストモードでは以下のカード番号を使用できます：

- **成功**: 4242 4242 4242 4242
- **失敗（残高不足）**: 4000 0000 0000 9995
- **失敗（カード拒否）**: 4000 0000 0000 0002

有効期限は任意の将来日付、CVVは任意の3桁の数字を使用してください。

## トラブルシューティング

### Stripeが読み込まれない
- `VITE_APP_STRIPE_PUBLISHABLE_KEY`が正しく設定されているか確認
- ブラウザの開発者ツールでコンソールエラーを確認

### 支払い後にエラーが発生する
- return_urlが正しく設定されているか確認
- バックエンドAPIが正常に動作しているか確認
- ネットワークタブでAPIレスポンスを確認

### プランが表示されない
- `VITE_APP_BILLING_API_ENDPOINT`が正しく設定されているか確認
- APIの認証トークンが有効か確認