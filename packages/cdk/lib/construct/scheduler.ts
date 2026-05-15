/**
 * Scheduler Construct
 *
 * Creates all infrastructure for the scheduled task execution feature:
 * - DynamoDB table (task definitions + execution logs)
 * - Lambda functions (API handlers + execution handler)
 * - API Gateway routes under /schedules
 * - IAM role for EventBridge Scheduler
 * - SQS Dead Letter Queue
 *
 * This construct is self-contained and does not modify existing GenU resources.
 */

import { Construct } from 'constructs';
import {
  RestApi,
  LambdaIntegration,
  CognitoUserPoolsAuthorizer,
  AuthorizationType,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import {
  NodejsFunction,
  NodejsFunctionProps,
} from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration, Stack, RemovalPolicy } from 'aws-cdk-lib';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { IVpc, ISecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';

export interface SchedulerProps {
  readonly userPool: UserPool;
  readonly api: RestApi;
  readonly agentNameToArnMap: Record<string, string>;
  readonly modelRegion: string;
  readonly agentCoreRegion?: string;
  // Closed network
  readonly vpc?: IVpc;
  readonly securityGroups?: ISecurityGroup[];
}

export class Scheduler extends Construct {
  constructor(scope: Construct, id: string, props: SchedulerProps) {
    super(scope, id);

    const { userPool, api, agentNameToArnMap, modelRegion, agentCoreRegion } =
      props;

    const region = Stack.of(this).region;
    const account = Stack.of(this).account;

    // --- DynamoDB Table ---
    const schedulerTable = new ddb.Table(this, 'SchedulerTable', {
      partitionKey: {
        name: 'pk',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: ddb.AttributeType.STRING,
      },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI for calendar view (user-wide execution query by date range)
    schedulerTable.addGlobalSecondaryIndex({
      indexName: 'UserExecutionIndex',
      partitionKey: {
        name: 'gsiPk',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsiSk',
        type: ddb.AttributeType.STRING,
      },
      projectionType: ddb.ProjectionType.INCLUDE,
      nonKeyAttributes: [
        'executionId',
        'taskId',
        'status',
        'startedAt',
        'completedAt',
      ],
    });

    // --- SQS Dead Letter Queue ---
    const dlq = new sqs.Queue(this, 'SchedulerDLQ', {
      retentionPeriod: Duration.days(14),
    });

    // --- IAM Role for EventBridge Scheduler ---
    const schedulerExecutionRole = new iam.Role(
      this,
      'SchedulerExecutionRole',
      {
        assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
          conditions: {
            StringEquals: { 'aws:SourceAccount': account },
          },
        }),
      }
    );

    // --- Execute Scheduled Task Lambda ---
    const agentRuntimeArns = Object.values(agentNameToArnMap);

    const executeFunction = new NodejsFunction(this, 'ExecuteScheduledTask', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/executeScheduledTask.ts',
      timeout: Duration.minutes(15),
      memorySize: 512,
      environment: {
        SCHEDULER_TABLE_NAME: schedulerTable.tableName,
        MODEL_REGION: modelRegion,
        AGENT_NAME_TO_ARN_MAP: JSON.stringify(agentNameToArnMap),
        USER_POOL_ID: userPool.userPoolId,
        ...(agentCoreRegion ? { AGENT_CORE_REGION: agentCoreRegion } : {}),
      },
      bundling: {
        nodeModules: [
          '@aws-sdk/client-bedrock-agentcore',
          '@aws-sdk/client-sns',
          '@aws-sdk/client-cognito-identity-provider',
        ],
      },
      vpc: props.vpc,
      securityGroups: props.securityGroups,
    });

    // Grant DynamoDB access
    schedulerTable.grantReadWriteData(executeFunction);

    // Grant AgentCore invoke permissions
    if (agentRuntimeArns.length > 0) {
      executeFunction.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['bedrock-agentcore:InvokeAgentRuntime'],
          resources: agentRuntimeArns.map((arn) => arn + '*'),
        })
      );
    }

    // Grant SNS publish permissions
    executeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'sns:Publish',
          'sns:CreateTopic',
          'sns:Subscribe',
          'sns:ListSubscriptionsByTopic',
        ],
        resources: [`arn:aws:sns:${region}:${account}:gaixer-notification-*`],
      })
    );

    // Grant Cognito permissions (for getting user email)
    executeFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminGetUser'],
        resources: [userPool.userPoolArn],
      })
    );

    // Allow EventBridge Scheduler to invoke the execute function
    schedulerExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [
          executeFunction.functionArn,
          `${executeFunction.functionArn}:*`,
        ],
      })
    );

    // Allow EventBridge Scheduler to send to DLQ
    schedulerExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sqs:SendMessage'],
        resources: [dlq.queueArn],
      })
    );

    // --- Scheduler API Lambda ---
    const commonLambdaProps: NodejsFunctionProps = {
      runtime: LAMBDA_RUNTIME_NODEJS,
      timeout: Duration.seconds(30),
      environment: {
        SCHEDULER_TABLE_NAME: schedulerTable.tableName,
        EXECUTE_FUNCTION_ARN: executeFunction.functionArn,
        SCHEDULER_ROLE_ARN: schedulerExecutionRole.roleArn,
        DLQ_ARN: dlq.queueArn,
        AGENT_NAME_TO_ARN_MAP: JSON.stringify(agentNameToArnMap),
        USER_POOL_ID: userPool.userPoolId,
      },
      bundling: {
        nodeModules: [
          '@aws-sdk/client-scheduler',
          '@aws-sdk/client-sns',
          '@aws-sdk/client-cognito-identity-provider',
        ],
      },
      vpc: props.vpc,
      securityGroups: props.securityGroups,
    };

    const schedulerApiFunction = new NodejsFunction(this, 'SchedulerApi', {
      ...commonLambdaProps,
      entry: './lambda/schedulerApi.ts',
    });

    // Grant DynamoDB access
    schedulerTable.grantReadWriteData(schedulerApiFunction);

    // Grant EventBridge Scheduler management
    schedulerApiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'scheduler:CreateSchedule',
          'scheduler:UpdateSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
        ],
        resources: [
          `arn:aws:scheduler:${region}:${account}:schedule/default/gaixer-task-*`,
        ],
      })
    );

    // Grant PassRole for EventBridge Scheduler execution role
    schedulerApiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['iam:PassRole'],
        resources: [schedulerExecutionRole.roleArn],
      })
    );

    // Grant SNS topic management
    schedulerApiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'sns:CreateTopic',
          'sns:Subscribe',
          'sns:ListSubscriptionsByTopic',
        ],
        resources: [`arn:aws:sns:${region}:${account}:gaixer-notification-*`],
      })
    );

    // Grant Cognito permissions
    schedulerApiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cognito-idp:AdminGetUser'],
        resources: [userPool.userPoolArn],
      })
    );

    // --- API Gateway Routes ---
    const authorizer = new CognitoUserPoolsAuthorizer(
      this,
      'SchedulerAuthorizer',
      {
        cognitoUserPools: [userPool],
      }
    );

    const commonAuthorizerProps = {
      authorizationType: AuthorizationType.COGNITO,
      authorizer,
    };

    const schedulerIntegration = new LambdaIntegration(schedulerApiFunction);

    // /schedules
    const schedulesResource = api.root.addResource('schedules');
    schedulesResource.addMethod(
      'POST',
      schedulerIntegration,
      commonAuthorizerProps
    );
    schedulesResource.addMethod(
      'GET',
      schedulerIntegration,
      commonAuthorizerProps
    );

    // /schedules/executions (calendar view - must be before {taskId})
    const schedulesExecutionsResource =
      schedulesResource.addResource('executions');
    schedulesExecutionsResource.addMethod(
      'GET',
      schedulerIntegration,
      commonAuthorizerProps
    );

    // /schedules/{taskId}
    const taskIdResource = schedulesResource.addResource('{taskId}');
    taskIdResource.addMethod(
      'GET',
      schedulerIntegration,
      commonAuthorizerProps
    );
    taskIdResource.addMethod(
      'PUT',
      schedulerIntegration,
      commonAuthorizerProps
    );
    taskIdResource.addMethod(
      'DELETE',
      schedulerIntegration,
      commonAuthorizerProps
    );

    // /schedules/{taskId}/executions
    const taskExecutionsResource = taskIdResource.addResource('executions');
    taskExecutionsResource.addMethod(
      'GET',
      schedulerIntegration,
      commonAuthorizerProps
    );

    // /schedules/{taskId}/executions/{executionId}
    const executionIdResource =
      taskExecutionsResource.addResource('{executionId}');
    executionIdResource.addMethod(
      'GET',
      schedulerIntegration,
      commonAuthorizerProps
    );
  }
}
