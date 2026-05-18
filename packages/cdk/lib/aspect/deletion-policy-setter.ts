import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

// Tag indicating a backup-protected resource. Used for marking on AWS resources
// (can be utilized for operations, cost analysis, AWS Backup target selection, etc.).
export const BACKUP_PROTECTED_TAG = {
  key: 'Backup',
  value: 'Protected',
} as const;

// Construct metadata indicating a backup-protected resource. Used for Aspect evaluation.
// cdk.Tags.of() propagates tags via Aspects, making it dependent on Aspect execution order,
// but construct.node.addMetadata() is synchronous so it can be reliably read from Aspects.
export const BACKUP_PROTECTED_METADATA_KEY = 'Backup';
export const BACKUP_PROTECTED_METADATA_VALUE = 'Protected';

// Traverse the construct tree upward (toward the parent scope) and determine
// whether any ancestor construct has the Backup: Protected metadata attached.
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
      // Resources with Backup: Protected metadata (and their children) are protected
      // under the backup plan, so do not force-apply RemovalPolicy.DESTROY (let individual
      // constructs keep their RETAIN policy).
      if (isBackupProtected(node)) return;
      node.applyRemovalPolicy(this.policy);
    }
  }
}
