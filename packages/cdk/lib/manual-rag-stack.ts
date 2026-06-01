import { Stack, StackProps } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { ProcessedStackInput } from './stack-input';
import { ManualStorage } from './construct/manual-rag/storage';
import { ManualAdminApi } from './construct/manual-rag/admin-api';

export interface ManualRagStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  // Cognito resources owned by GenerativeAiUseCasesStack, injected from
  // create-stacks.ts (this stack is created after it). Used by the admin API
  // authorizer (B2).
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
}

/**
 * Stack that groups the infrastructure of the Manual RAG feature.
 * The authoritative design lives in the FIXER.Medical.AgentCore repository at
 * docs/dev-diary/naito/documents/manual-implementation-plan.md, and the GenU-side
 * CDK procedure in manual-cdk-deploy-plan.md.
 *
 * B1: storage skeleton (S3 + DynamoDB).
 * B2: manual admin API (REST API + management Lambdas).
 * The chat relay Lambda / preprocessing Lambda / AgentCore Runtime wiring is added
 * in later phases.
 */
export class ManualRagStack extends Stack {
  public readonly storage: ManualStorage;
  public readonly adminApi: ManualAdminApi;

  constructor(scope: Construct, id: string, props: ManualRagStackProps) {
    super(scope, id, props);

    this.storage = new ManualStorage(this, 'ManualStorage');

    this.adminApi = new ManualAdminApi(this, 'ManualAdminApi', {
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      storage: this.storage,
    });
  }
}
