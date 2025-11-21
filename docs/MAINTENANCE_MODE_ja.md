# メンテナンスモード - 完全ガイド

このドキュメントでは、GenU（生成AIユースケース）デプロイメントのメンテナンスモード機能の使用方法について説明します。

## 🚀 クイックスタート

```bash
# メンテナンスモードを有効化
./scripts/maintenance.sh tmp on

# メンテナンスモードを無効化
./scripts/maintenance.sh tmp off

# ステータス確認
./scripts/maintenance.sh tmp status

# 動作確認
./scripts/validate-maintenance.sh tmp
```

## 📋 目次

1. [概要](#概要)
2. [スクリプト](#スクリプト)
3. [一般的なタスク](#一般的なタスク)
4. [トラブルシューティング](#トラブルシューティング)
5. [アーキテクチャ](#アーキテクチャ)
6. [ベストプラクティス](#ベストプラクティス)

## 概要

メンテナンスモード機能により、サイトのメンテナンス中にユーザーにメンテナンスページを一時的に表示しながら、ホワイトリストに登録されたIPアドレス（管理チームなど）からのアクセスは許可できます。

### 主な機能

- ✅ **ワンコマンド切替** - 単一コマンドで有効化/無効化
- ✅ **自動キャッシュ無効化** - 手動作業不要
- ✅ **IPホワイトリスト** - 特定のIPからのアクセスを許可
- ✅ **マルチ環境対応** - tmp、devel、produ、hosoyに対応
- ✅ **検証ツール** - メンテナンスモードの動作確認
- ✅ **カラー出力** - 読みやすいステータス情報

### 動作の仕組み

```
ユーザーリクエスト → CloudFront → Viewer Request Function
                                ↓
                        KeyValueStoreを確認
                                ↓
                    ┌───────────┴───────────┐
                    ↓                       ↓
            maintenance = true      maintenance = false
                    ↓                       ↓
            IPホワイトリストを確認      リクエストを許可
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
    IPがホワイトリスト      ホワイトリスト外
        ↓                       ↓
    リクエストを許可       /maintenance.htmlへリダイレクト
```

## スクリプト

### `maintenance.sh` - クイックラッパー

**一般的な操作のためのシンプルなインターフェース**

```bash
./scripts/maintenance.sh <env> <on|off|status>
```

**使用例:**
```bash
./scripts/maintenance.sh tmp on      # tmp環境で有効化
./scripts/maintenance.sh tmp off     # tmp環境で無効化
./scripts/maintenance.sh tmp status  # 現在のステータス確認
```

### `maintenance-mode.sh` - 全機能版スクリプト

**すべての機能を備えた完全なメンテナンスモード管理**

```bash
./scripts/maintenance-mode.sh <env> <command> [options]
```

**コマンド:**
- `on` - メンテナンスモードを有効化
- `off` - メンテナンスモードを無効化
- `status` - 現在のステータスを表示
- `whitelist-add <ips>` - IPをホワイトリストに追加
- `whitelist-rm <ips>` - IPをホワイトリストから削除
- `whitelist-show` - ホワイトリストに登録されたIPを表示
- `whitelist-clear` - すべてのIPをクリア

**オプション:**
- `--profile <name>` - AWSプロファイル（デフォルト: genu）
- `--no-invalidate` - キャッシュ無効化をスキップ
- `--help` - ヘルプを表示

**使用例:**
```bash
# カスタムプロファイルで有効化
./scripts/maintenance-mode.sh produ on --profile production

# 複数のIPをホワイトリストに追加
./scripts/maintenance-mode.sh tmp whitelist-add 203.0.113.1,198.51.100.50

# 現在のホワイトリストを表示
./scripts/maintenance-mode.sh tmp whitelist-show

# IPをホワイトリストから削除
./scripts/maintenance-mode.sh tmp whitelist-rm 203.0.113.1
```

### `validate-maintenance.sh` - 検証ツール

**メンテナンスモードが正しく動作しているか確認**

```bash
./scripts/validate-maintenance.sh <env> [--profile <profile>]
```

**チェック内容:**
1. ✅ KeyValueStore設定
2. ✅ CloudFront Function紐付け
3. ✅ 実際のHTTP動作
4. ✅ 最近のキャッシュ無効化

**使用例:**
```bash
./scripts/validate-maintenance.sh tmp
```

## 一般的なタスク

### メンテナンスモードの有効化

```bash
# 1. メンテナンスモードを有効化
./scripts/maintenance.sh tmp on

# 2. 動作確認（オプション）
./scripts/validate-maintenance.sh tmp

# 3. ブラウザでテスト
# URL: https://<cloudfront-domain>
# メンテナンスページが表示されるはず
```

### メンテナンスモードの無効化

```bash
# 1. メンテナンスモードを無効化
./scripts/maintenance.sh tmp off

# 2. 伝播を待つ（60秒）

# 3. ブラウザで強制リロード（重要！）
# Windows/Linux: Ctrl + Shift + R
# Mac: Cmd + Shift + R
# またはシークレット/プライベートモードを使用

# 4. 確認（オプション）
./scripts/validate-maintenance.sh tmp
```

### チームのIPをホワイトリストに追加

```bash
# 1. チームのIPを追加
./scripts/maintenance-mode.sh tmp whitelist-add 203.0.113.1,198.51.100.50

# 2. メンテナンスモードを有効化
./scripts/maintenance.sh tmp on

# 3. ホワイトリストに登録されたIPからアクセスできることを確認
# チームはメンテナンスページではなく、通常のサイトが見えるはず
```

### 現在のステータス確認

```bash
./scripts/maintenance.sh tmp status
```

**出力例:**
```
=== メンテナンスモードステータス ===
✓ メンテナンスモード: 無効

=== IPホワイトリスト ===
  - 203.0.113.1
  - 198.51.100.50

=== CloudFront ディストリビューション ===
  Distribution ID: <distribution-id>
  URL: https://<cloudfront-domain>
```

### 定期メンテナンスの例

```bash
#!/bin/bash
# scheduled-maintenance.sh

echo "$(date) に定期メンテナンスを開始"

# 1. メンテナンスモードを有効化
./scripts/maintenance.sh produ on

# 2. 伝播を待つ
sleep 60

# 3. デプロイメント/更新を実行
echo "デプロイメントを実行中..."
# ... デプロイコマンドをここに記述 ...

# 4. デプロイメント完了を待つ
sleep 300

# 5. メンテナンスモードを無効化
./scripts/maintenance.sh produ off

echo "$(date) にメンテナンス完了"
```

## トラブルシューティング

### 問題: 無効化後もメンテナンスページが表示される

**症状:** `false`に設定したのにメンテナンスページが表示される

**原因:**
1. ブラウザが302リダイレクトをキャッシュしている
2. CloudFrontのエッジキャッシュが無効化されていない
3. 伝播に十分な時間が経過していない

**解決方法:**
```bash
# 1. KVSが正しく設定されているか確認
./scripts/maintenance.sh tmp status

# 2. キャッシュが無効化されたことを確認（スクリプトが自動実行）
./scripts/maintenance.sh tmp off

# 3. 60秒待つ
sleep 60

# 4. ブラウザで強制リロード（重要！）
# Windows/Linux: Ctrl + Shift + R
# Mac: Cmd + Shift + R

# 5. またはシークレット/プライベートモードを使用
```

### 問題: メンテナンスモードが有効化されない

**症状:** `true`に設定したのにサイトにアクセスできる

**解決方法:**
```bash
# 1. ステータス確認
./scripts/maintenance.sh tmp status

# 2. KVSにmaintenance=trueが設定されているか確認
aws --profile <profile> cloudfront-keyvaluestore list-keys \
  --kvs-arn <kvs-arn>

# 3. 自分のIPがホワイトリストに登録されていないか確認
./scripts/maintenance-mode.sh tmp whitelist-show

# 4. 設定を検証
./scripts/validate-maintenance.sh tmp

# 5. 一度OFFにしてから再度ONにする
./scripts/maintenance.sh tmp off
sleep 10
./scripts/maintenance.sh tmp on
```

### 問題: スクリプトがスタックを見つけられない

**症状:** "Could not find Web stack for environment: tmp"

**解決方法:**
```bash
# 1. 環境名を確認
# 有効な環境: tmp, devel, produ, hosoy

# 2. AWSプロファイルを確認
aws --profile <profile> sts get-caller-identity

# 3. 利用可能なスタックを一覧表示
aws --profile <profile> cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE
```

### 問題: IPホワイトリストが機能しない

**症状:** IPがホワイトリストに登録されているのにメンテナンスページが表示される

**原因:**
1. IPが正確に一致しない（CIDRレンジ非対応）
2. プロキシ/NATの背後（パブリックIPが想定と異なる）
3. IPv4とIPv6の不一致

**解決方法:**
```bash
# 1. 自分のパブリックIPを確認
curl ifconfig.me

# 2. 実際のパブリックIPを追加
./scripts/maintenance-mode.sh tmp whitelist-add $(curl -s ifconfig.me)

# 3. ホワイトリストを確認
./scripts/maintenance-mode.sh tmp whitelist-show

# 4. ブラウザでテスト
# メンテナンスページではなく、通常のサイトが見えるはず
```

### 問題: キャッシュ無効化に時間がかかりすぎる

**症状:** 5分以上経過しても変更が反映されない

**注意:** CloudFrontのキャッシュ無効化は通常30〜60秒で完了しますが、最大15分かかる場合があります。

**解決方法:**
```bash
# 1. 無効化ステータスを確認
aws --profile <profile> cloudfront list-invalidations \
  --distribution-id <distribution-id> --max-items 1

# 2. ステータスがCompletedになるまで待つ

# 3. ブラウザで強制リロード
# Ctrl + Shift + R (または Cmd + Shift + R)

# 4. curlでテスト（ブラウザキャッシュを回避）
curl -I "https://<cloudfront-domain>/test-$(date +%s).html"
```

## アーキテクチャ

### コンポーネント

```
┌────────────────────────────────────────────────────┐
│ CloudFront Distribution                            │
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │ Viewer Request Function                  │    │
│  │ - maintenance & ipWhitelistキーを読込    │    │
│  │ - maintenance ONなら302リダイレクト返却  │    │
│  │ - ホワイトリストIPは通過許可              │    │
│  └──────────────────────────────────────────┘    │
│                  ↓                                 │
│  ┌──────────────────────────────────────────┐    │
│  │ KeyValueStore (KVS)                      │    │
│  │ - maintenance: "true" | "false"          │    │
│  │ - ipWhitelist: "ip1,ip2,..."             │    │
│  │ ARN: <kvs-arn>                           │    │
│  └──────────────────────────────────────────┘    │
│                                                    │
│  ┌──────────────────────────────────────────┐    │
│  │ S3 Bucket (メンテナンスアセット)         │    │
│  │ - maintenance.html                        │    │
│  │ - maintenance.css                         │    │
│  └──────────────────────────────────────────┘    │
└────────────────────────────────────────────────────┘
```

### CloudFront Function ロジック

`packages/cdk/cloudfront-functions/viewer-request.js`に配置:

```javascript
// 1. KVSから値を取得
const maintenance = await kvsHandle.get('maintenance');
const ipWhitelist = await kvsHandle.get('ipWhitelist');

// 2. メンテナンスOFFなら全リクエストを許可
if (maintenance !== 'true' && maintenance !== true) {
  return request;
}

// 3. クライアントIPがホワイトリストにあるか確認
const whitelistedIps = ipWhitelist ? ipWhitelist.split(',') : [];
if (whitelistedIps.includes(clientIp)) {
  return request;
}

// 4. メンテナンスアセットのリダイレクトループを防止
if (uri === '/maintenance.html' || uri === '/maintenance.css') {
  return request;
}

// 5. メンテナンスページへリダイレクト
return {
  statusCode: 302,
  statusDescription: 'Found',
  headers: { location: { value: '/maintenance.html' } }
};
```

### エラーハンドリング

Functionは**フェイルオープン**のエラーハンドリングを使用:

```javascript
try {
  // ... メンテナンスロジック ...
} catch (error) {
  // エラーが発生した場合（KVSアクセス失敗など）、
  // サイト全体が停止しないようリクエストを通過させる
  console.log('Error: ' + error.message);
  return request;
}
```

これにより、CloudFront Functionのエラーでサイト全体が停止することを防ぎます。

## ベストプラクティス

### 1. スクリプトを使用し、手動コマンドは避ける

```bash
# ❌ 悪い例 - キャッシュ無効化なしの手動コマンド
aws cloudfront-keyvaluestore put-key ...

# ✅ 良い例 - スクリプトを使用（自動的にキャッシュ無効化含む）
./scripts/maintenance.sh tmp on
```

### 2. 下位環境で先にテスト

```bash
# 1. tmp環境でテスト
./scripts/maintenance.sh tmp on
# メンテナンスページが動作することを確認
./scripts/validate-maintenance.sh tmp

# 2. 無効化して確認
./scripts/maintenance.sh tmp off
# サイトにアクセスできることを確認

# 3. 本番環境に適用
./scripts/maintenance.sh produ on
```

### 3. 管理/運用チームのIPをホワイトリスト登録

```bash
# メンテナンス有効化前に運用チームのIPを追加
./scripts/maintenance-mode.sh tmp whitelist-add 203.0.113.1,198.51.100.50

# その後メンテナンスモードを有効化
./scripts/maintenance.sh tmp on

# チームは引き続きサイトにアクセス可能
```

### 4. メンテナンス時間の周知

- ユーザーに事前通知（メール、アプリ内通知）
- 開始/終了時刻を明記
- 予定時刻にメンテナンスモードを有効化
- メンテナンス中はエラーを監視
- サービス復旧時に通知

### 5. メンテナンス中の監視

```bash
# CloudWatchでエラーを確認
aws logs tail /aws/cloudfront/distribution/<distribution-id> --follow

# メンテナンスページが読み込まれているか確認
curl -I https://<cloudfront-domain>

# キャッシュ無効化ステータスを確認
./scripts/maintenance-mode.sh <env> status
```

### 6. 変更後は必ず検証

```bash
# メンテナンスモード変更後
./scripts/validate-maintenance.sh tmp
```

## 追加リソース

- **クイックリファレンス**: [`scripts/QUICKREF_ja.md`](../scripts/QUICKREF_ja.md)
- **詳細ドキュメント**: [`scripts/README_ja.md`](../scripts/README_ja.md)
- **CloudFront Function**: `packages/cdk/cloudfront-functions/viewer-request.js`
- **CDK Construct**: `packages/cdk/lib/construct/maintenance-mode.ts`

## サポート

問題や質問がある場合:
1. このガイドとトラブルシューティングセクションを確認
2. 検証を実行: `./scripts/validate-maintenance.sh tmp`
3. AWS CloudFormationコンソールでスタックステータスを確認
4. CloudFront Functionログを確認（利用可能な場合）
