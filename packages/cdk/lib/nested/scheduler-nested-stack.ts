import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
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
 * Child -> parent references are one-directional: RestApi (restApiId/rootResourceId) and
 * UserPool. The parent must wire `api.api.latestDeployment?.node.addDependency(thisStack)`.
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
    });
  }
}
