#!/bin/bash
# backup-readiness-check.sh
# 本書 P-01〜P-13 の設定確認を一括で行うスクリプト
# 関連: docs/dev-diary/naito/plan/バックアップリソース準備手順書.md §8.2
#       docs/dev-diary/naito/plan/backup-resource-implementation-plan.md §5.2.9

set -u
REGION="ap-northeast-1"

# === Phase 2 で実値が確定済の分離保管バケット名（命名規約：v1.4） ===
BACKUP_LOCKED_DDB="genu-gaixer-devel-backup-locked-ddb-ap-northeast-1"
BACKUP_LOCKED_S3="genu-gaixer-devel-backup-locked-s3-ap-northeast-1"
BACKUP_LOCKED_COGNITO="genu-gaixer-devel-backup-locked-cognito-ap-northeast-1"

# === デプロイ後に CFn で自動採番される値（実行時に環境変数で渡す） ===
# 取得方法:
#   aws cloudformation describe-stack-resources \
#     --stack-name GenerativeAiUseCasesStack \
#     --query "StackResources[?ResourceType=='AWS::DynamoDB::Table'].PhysicalResourceId" \
#     --output text
#
# 使い方:
#   MAIN_TABLE=... STATS_TABLE=... FILE_BUCKET=... ./scripts/backup-readiness-check.sh
#
# useCaseBuilderEnabled=false / agentBuilderEnabled=false の場合、
# USE_CASE_BUILDER_TABLE は空のままにしてください。
MAIN_TABLE="${MAIN_TABLE:-<MAIN_TABLE_NAME_FROM_CFN>}"
STATS_TABLE="${STATS_TABLE:-<STATS_TABLE_NAME_FROM_CFN>}"
USE_CASE_BUILDER_TABLE="${USE_CASE_BUILDER_TABLE:-}"
FILE_BUCKET="${FILE_BUCKET:-<FILE_BUCKET_NAME_FROM_CFN>}"

# === AWS アカウント ID は実行時に動的取得 ===
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account ID: $ACCOUNT_ID"
echo "Region: $REGION"
echo ""

# 対象テーブル配列の組み立て（UseCaseBuilder は環境変数が空なら除外）
TABLES=("$MAIN_TABLE" "$STATS_TABLE")
if [ -n "$USE_CASE_BUILDER_TABLE" ]; then
  TABLES+=("$USE_CASE_BUILDER_TABLE")
fi

echo "=== P-01: DynamoDB PITR + Deletion Protection ==="
for TABLE in "${TABLES[@]}"; do
  STATUS=$(aws dynamodb describe-continuous-backups --region "$REGION" \
    --table-name "$TABLE" \
    --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
    --output text 2>/dev/null || echo "TABLE_NOT_FOUND")
  PROTECT=$(aws dynamodb describe-table --region "$REGION" \
    --table-name "$TABLE" \
    --query 'Table.DeletionProtectionEnabled' \
    --output text 2>/dev/null || echo "N/A")
  echo "  $TABLE: PITR=$STATUS, DeletionProtection=$PROTECT"
done

echo ""
echo "=== P-02 / P-04 / P-05: S3 FileBucket settings ==="
echo "  --- $FILE_BUCKET ---"
echo "  Versioning: $(aws s3api get-bucket-versioning --bucket "$FILE_BUCKET" --query 'Status' --output text 2>/dev/null)"
echo "  Encryption: $(aws s3api get-bucket-encryption --bucket "$FILE_BUCKET" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text 2>/dev/null)"
echo "  PublicAccessBlock: $(aws s3api get-public-access-block --bucket "$FILE_BUCKET" --query 'PublicAccessBlockConfiguration' --output json 2>/dev/null)"

echo ""
echo "=== P-06 / P-12: Cognito export (today's output exists) ==="
TODAY=$(date -u +%Y-%m-%d)
aws s3 ls "s3://$BACKUP_LOCKED_COGNITO/cognito-exports/$TODAY/" 2>/dev/null && echo "  OK" || echo "  本日分のエクスポートなし（初回デプロイ翌日まで未生成）"

echo ""
echo "=== P-08: CloudWatch Logs retention (Phase 9 にて対応予定) ==="
echo "  ※ Lambda 自動生成 LogGroup の retention 一括設定は別 Phase で実施"
aws logs describe-log-groups --region "$REGION" \
  --query 'logGroups[?starts_with(logGroupName, `/aws/lambda/`)].{name:logGroupName, retention:retentionInDays}' \
  --output table 2>/dev/null

echo ""
echo "=== P-09: 分離保管バケットの Object Lock 設定 ==="
for BUCKET in "$BACKUP_LOCKED_DDB" "$BACKUP_LOCKED_S3" "$BACKUP_LOCKED_COGNITO"; do
  echo "  --- $BUCKET ---"
  echo "  ObjectLock: $(aws s3api get-object-lock-configuration --bucket "$BUCKET" --query 'ObjectLockConfiguration.Rule.DefaultRetention' --output json 2>/dev/null)"
  echo "  Versioning: $(aws s3api get-bucket-versioning --bucket "$BUCKET" --query 'Status' --output text 2>/dev/null)"
done

echo ""
echo "=== P-10: DynamoDB PITR Export to S3 の最新ジョブ確認 ==="
for TABLE in "${TABLES[@]}"; do
  TABLE_ARN="arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE}"
  LATEST=$(aws dynamodb list-exports --table-arn "$TABLE_ARN" \
    --query 'ExportSummaries | sort_by(@, &ExportArn) | [-1].ExportStatus' \
    --output text 2>/dev/null || echo "N/A")
  echo "  $TABLE: latest export status=$LATEST"
done

echo ""
echo "=== P-11: S3 レプリケーション設定確認 ==="
RULE_STATUS=$(aws s3api get-bucket-replication --bucket "$FILE_BUCKET" \
  --query 'ReplicationConfiguration.Rules[0].Status' --output text 2>/dev/null || echo "NotConfigured")
echo "  $FILE_BUCKET: $RULE_STATUS"

echo ""
echo "=== P-13: 復元実施者ロールの分離保管バケット読取権限 ==="
echo "  Policy Simulator で確認してください（自動化は本スクリプトの範囲外）"
echo "  例: aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::${ACCOUNT_ID}:role/<RestoreRoleName> --action-names s3:GetObject --resource-arns arn:aws:s3:::${BACKUP_LOCKED_DDB}/*"

echo ""
echo "=== Done ==="
