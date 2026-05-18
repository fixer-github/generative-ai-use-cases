import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

// バックアップ保護対象リソースを示すタグ。AWS リソース上のマーキング用
// （運用・コスト分析・AWS Backup の対象指定等で活用可能）。
export const BACKUP_PROTECTED_TAG = {
  key: 'Backup',
  value: 'Protected',
} as const;

// バックアップ保護対象リソースを示す Construct メタデータ。Aspect 判定用。
// cdk.Tags.of() はタグ自体が Aspect 経由で伝播するため Aspect 実行順序に依存して
// しまうが、construct.node.addMetadata() は同期処理なので Aspect から確実に読める。
export const BACKUP_PROTECTED_METADATA_KEY = 'Backup';
export const BACKUP_PROTECTED_METADATA_VALUE = 'Protected';

// Construct ツリーをスコープ方向（親方向）に辿り、いずれかの祖先 construct に
// Backup: Protected メタデータが付与されているかを判定する。
const isBackupProtected = (node: IConstruct): boolean => {
  let current: IConstruct | undefined = node;
  while (current) {
    if (
      current.node.metadata.some(
        (m) =>
          m.type === BACKUP_PROTECTED_METADATA_KEY &&
          m.data === BACKUP_PROTECTED_METADATA_VALUE
      )
    ) {
      return true;
    }
    current = current.node.scope;
  }
  return false;
};

export class DeletionPolicySetter implements cdk.IAspect {
  constructor(private readonly policy: cdk.RemovalPolicy) {}

  visit(node: IConstruct): void {
    if (node instanceof cdk.CfnResource) {
      // Backup: Protected メタデータを持つリソース（およびその子）はバックアップ計画上の
      // 保護対象のため、RemovalPolicy.DESTROY を強制適用しない（個別 construct 側で
      // RETAIN を保持させる）。
      if (isBackupProtected(node)) return;
      node.applyRemovalPolicy(this.policy);
    }
  }
}
