import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { LAMBDA_RUNTIME_NODEJS, DEFAULT_TENANT_ID } from '../../consts';
import { TenantManager } from './tenant-manager';

export interface SummaryGeneratorProps {
  readonly environment: string;
  readonly modelRegion: string;

  // Tables
  readonly chatHistoryTable: Table;
  readonly userSummaryTable: Table;
  readonly statsTable: Table;

  // Tenant management
  readonly tenantManager?: TenantManager;

  // LiteLLM proxy endpoint (optional)
  readonly litellmEndpoint?: string | null;

  // Schedule configuration
  readonly summaryJobConfig: {
    dailySummarySchedule: {
      minute: string;
      hour: string;
      month: string;
      weekDay: string;
    };
    dailySummaryMaxChars: number;
    userSummaryMaxChars: number;
    userSummaryDefaultTermUnit: 'month' | 'year';
    userSummaryDefaultTermValue: number;
    summaryModelId: string;
    maxConcurrentUsers: number;
    enableExternalContext: boolean;
  };
}

export class SummaryGenerator extends Construct {
  public readonly dailySummaryFunction: NodejsFunction;
  public readonly userSummaryFunction: NodejsFunction;
  public readonly stateMachine: stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, props: SummaryGeneratorProps) {
    super(scope, id);

    const {
      environment,
      modelRegion,
      chatHistoryTable,
      userSummaryTable,
      statsTable,
      tenantManager,
      litellmEndpoint,
      summaryJobConfig,
    } = props;

    // Common environment variables for Lambda functions
    const commonEnv = {
      ENVIRONMENT: environment,
      MODEL_REGION: modelRegion,
      AWS_ACCOUNT_ID: cdk.Stack.of(this).account,
      SUMMARY_MODEL_ID: summaryJobConfig.summaryModelId,
      DAILY_SUMMARY_MAX_CHARS: summaryJobConfig.dailySummaryMaxChars.toString(),
      USER_SUMMARY_MAX_CHARS: summaryJobConfig.userSummaryMaxChars.toString(),
      DEFAULT_TERM_UNIT: summaryJobConfig.userSummaryDefaultTermUnit,
      DEFAULT_TERM_VALUE: summaryJobConfig.userSummaryDefaultTermValue.toString(),
      TABLE_NAME: 'ChatHistory',
      DEFAULT_TABLE_NAME: chatHistoryTable.tableName,
      STATS_TABLE_NAME: 'TokenUsageStats',
      DEFAULT_STATS_TABLE_NAME: statsTable.tableName,
      USER_SUMMARY_TABLE_NAME: 'UserSummary',
      DEFAULT_USER_SUMMARY_TABLE_NAME: userSummaryTable.tableName,
      DEFAULT_TENANT_ID: DEFAULT_TENANT_ID,
      // LiteLLM endpoint for using proxy instead of direct Bedrock
      ...(litellmEndpoint ? { LITELLM_ENDPOINT: litellmEndpoint } : {}),
      ...(tenantManager
        ? { TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName }
        : {}),
    };

    // Daily Summary Lambda
    this.dailySummaryFunction = new NodejsFunction(this, 'DailySummary', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/summary/generateDailySummary.ts',
      handler: 'handler',
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: commonEnv,
    });

    // User Summary Lambda
    this.userSummaryFunction = new NodejsFunction(this, 'UserSummary', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/summary/generateUserSummary.ts',
      handler: 'handler',
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: commonEnv,
    });

    // Grant table permissions
    chatHistoryTable.grantReadData(this.dailySummaryFunction);
    userSummaryTable.grantReadWriteData(this.dailySummaryFunction);
    userSummaryTable.grantReadWriteData(this.userSummaryFunction);
    statsTable.grantReadData(this.dailySummaryFunction);

    if (tenantManager) {
      tenantManager.tenantsTable.grantReadData(this.dailySummaryFunction);
      tenantManager.tenantsTable.grantReadData(this.userSummaryFunction);
    }

    // Grant Bedrock access
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:Converse'],
      resources: ['*'],
    });

    this.dailySummaryFunction.addToRolePolicy(bedrockPolicy);
    this.userSummaryFunction.addToRolePolicy(bedrockPolicy);

    // Grant STS AssumeRole for tenant cross-account access (batch mode)
    const stsAssumeRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sts:AssumeRole'],
      resources: ['*'], // Tenant roles are dynamically created
    });

    this.dailySummaryFunction.addToRolePolicy(stsAssumeRolePolicy);
    this.userSummaryFunction.addToRolePolicy(stsAssumeRolePolicy);

    // Grant Lambda Function URL invocation for LiteLLM proxy (if configured)
    if (litellmEndpoint) {
      const lambdaInvokeUrlPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunctionUrl'],
        resources: ['*'], // LiteLLM Function URL ARN is derived from endpoint
      });

      this.dailySummaryFunction.addToRolePolicy(lambdaInvokeUrlPolicy);
      this.userSummaryFunction.addToRolePolicy(lambdaInvokeUrlPolicy);
    }

    // Step Functions definition
    // Task 1: Generate Daily Summaries
    // Use resultPath to preserve original input (tenantId, date, users) for the next task
    const dailySummaryTask = new stepfunctionsTasks.LambdaInvoke(
      this,
      'GenerateDailySummaries',
      {
        lambdaFunction: this.dailySummaryFunction,
        resultPath: '$.dailySummaryResult',
        payload: stepfunctions.TaskInput.fromObject({
          'tenantId.$': '$.tenantId',
          'date.$': '$.date',
          'users.$': '$.users',
        }),
      }
    );

    // Task 2: Generate User Summaries (runs after daily summaries complete)
    const userSummaryTask = new stepfunctionsTasks.LambdaInvoke(
      this,
      'GenerateUserSummaries',
      {
        lambdaFunction: this.userSummaryFunction,
        resultPath: '$.userSummaryResult',
        payload: stepfunctions.TaskInput.fromObject({
          'tenantId.$': '$.tenantId',
          'termEnd.$': '$.date',
          'users.$': '$.users',
        }),
      }
    );

    // Chain the tasks
    const definition = dailySummaryTask.next(userSummaryTask);

    // Create State Machine
    this.stateMachine = new stepfunctions.StateMachine(
      this,
      'SummaryStateMachine',
      {
        definitionBody: stepfunctions.DefinitionBody.fromChainable(definition),
        timeout: Duration.hours(2),
        stateMachineName: `SummaryGenerator-${environment}`,
      }
    );

    // EventBridge Rule for scheduled execution
    const { dailySummarySchedule } = summaryJobConfig;

    new events.Rule(this, 'SummaryScheduleRule', {
      schedule: events.Schedule.cron({
        minute: dailySummarySchedule.minute,
        hour: dailySummarySchedule.hour,
        month: dailySummarySchedule.month,
        weekDay: dailySummarySchedule.weekDay,
      }),
      targets: [
        new targets.SfnStateMachine(this.stateMachine, {
          input: events.RuleTargetInput.fromObject({
            tenantId: 'default', // Will be overridden per tenant
            date: events.EventField.time, // Current time for date calculation
            users: [], // Will be populated by the Lambda
          }),
        }),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'SummaryStateMachineArn', {
      value: this.stateMachine.stateMachineArn,
      description: 'ARN of the summary generation state machine',
    });

    new cdk.CfnOutput(this, 'DailySummaryFunctionArn', {
      value: this.dailySummaryFunction.functionArn,
      description: 'ARN of the daily summary Lambda function',
    });

    new cdk.CfnOutput(this, 'UserSummaryFunctionArn', {
      value: this.userSummaryFunction.functionArn,
      description: 'ARN of the user summary Lambda function',
    });

    // Export Lambda role ARN for cross-account tenant trust
    new cdk.CfnOutput(this, 'DailySummaryLambdaRoleArn', {
      value: this.dailySummaryFunction.role!.roleArn,
      description:
        'ARN of the daily summary Lambda role - add to tenant role trust policy for cross-account access',
      exportName: `${cdk.Stack.of(this).stackName}-DailySummaryLambdaRoleArn`,
    });
  }
}
