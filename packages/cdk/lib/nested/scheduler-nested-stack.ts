import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { Scheduler } from '../construct/scheduler';

/**
 * SchedulerNestedStack
 *
 * Child NestedStack carved out of the parent stack for the scheduled-task feature.
 * Carries the whole Scheduler construct wholesale: SchedulerTable (+GSI), the SQS DLQ,
 * the EventBridge execution role, the execute/API Lambdas, and the `/schedules/*` routes.
 *
 * Stateful resources move into the child and are re-created empty (existing schedules in
 * SchedulerTable are lost — accepted per the dev/PoC data-loss decision). The
 * DeletionPolicySetter(DESTROY) Aspect on the parent propagates into this child, so the
 * old in-parent table/DLQ are deleted (not orphaned) on deploy A.
 *
 * NOTE (operational): schedule firing instances live in EventBridge Scheduler
 * (`default` group, `gaixer-task-*`) created at runtime by the API Lambda — they are NOT
 * CloudFormation-managed and must be cleaned up manually around the migration (memo §5-6).
 *
 * Child -> parent references are one-directional: RestApi (restApiId/rootResourceId),
 * UserPool, and (step 5/6) the parent NotificationTable + main Chat table, which the
 * execute Lambda writes to (grantWriteData = child role policy -> parent table ARN; this
 * does not cycle). The parent must wire `api.api.latestDeployment?.node.addDependency(thisStack)`.
 */
export interface SchedulerNestedStackProps extends NestedStackProps {
  readonly userPool: UserPool;
  readonly api: RestApi;
  readonly agentNameToArnMap: Record<string, string>;
  readonly modelRegion: string;
  readonly agentCoreRegion?: string;
  readonly sendgridApiKey?: string | null;
  readonly mailFrom?: string | null;
  readonly closedNetworkMode?: boolean;
  readonly vpc?: IVpc;
  readonly securityGroups?: ISecurityGroup[];
  // Parent-owned tables the execute Lambda writes to (bell + sidebar projection).
  readonly notificationTable: ITable;
  readonly table: ITable;
}

export class SchedulerNestedStack extends NestedStack {
  constructor(scope: Construct, id: string, props: SchedulerNestedStackProps) {
    super(scope, id, props);

    new Scheduler(this, 'Scheduler', {
      userPool: props.userPool,
      api: props.api,
      agentNameToArnMap: props.agentNameToArnMap,
      modelRegion: props.modelRegion,
      agentCoreRegion: props.agentCoreRegion,
      sendgridApiKey: props.sendgridApiKey,
      mailFrom: props.mailFrom,
      closedNetworkMode: props.closedNetworkMode,
      vpc: props.vpc,
      securityGroups: props.securityGroups,
      notificationTable: props.notificationTable,
      table: props.table,
    });
  }
}
