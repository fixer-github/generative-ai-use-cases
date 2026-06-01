import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { ProcessedStackInput } from './stack-input';
import { ManualStorage } from './construct/manual-rag/storage';
import { ManualAdminApi } from './construct/manual-rag/admin-api';
import { ManualPreprocess } from './construct/manual-rag/preprocess';

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
 * B4: preprocessing Lambda (TXT/Markdown page splitting), wired to S3 events and to
 *     the reprocess Lambda via PREPROCESS_FUNCTION_ARN.
 * The chat relay Lambda / AgentCore Runtime wiring is added in later phases.
 */
export class ManualRagStack extends Stack {
  public readonly storage: ManualStorage;
  public readonly adminApi: ManualAdminApi;
  public readonly preprocess: ManualPreprocess;

  constructor(scope: Construct, id: string, props: ManualRagStackProps) {
    super(scope, id, props);

    this.storage = new ManualStorage(this, 'ManualStorage');

    this.adminApi = new ManualAdminApi(this, 'ManualAdminApi', {
      userPool: props.userPool,
      userPoolClient: props.userPoolClient,
      storage: this.storage,
    });

    this.preprocess = new ManualPreprocess(this, 'ManualPreprocess', {
      storage: this.storage,
    });

    // Let the reprocess Lambda invoke the preprocessing Lambda (B2 left this as an
    // empty placeholder env var; B4 fills it in).
    this.adminApi.reprocessManualFunction.addEnvironment(
      'PREPROCESS_FUNCTION_ARN',
      this.preprocess.function.functionArn
    );
    this.preprocess.function.grantInvoke(
      this.adminApi.reprocessManualFunction
    );

    // Outputs for the (separately developed) GenU frontend to wire against.
    new CfnOutput(this, 'ManualAdminApiEndpoint', {
      value: this.adminApi.api.url,
    });
    new CfnOutput(this, 'ManualBucketName', {
      value: this.storage.bucket.bucketName,
    });
    new CfnOutput(this, 'ManualTableName', {
      value: this.storage.table.tableName,
    });
  }
}
