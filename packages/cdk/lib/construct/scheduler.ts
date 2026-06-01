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
  // SendGrid email notification. The API key and sender address are passed
  // through directly (configured in cdk.json). When unset, or in
  // closed-network mode, email notifications are disabled.
  readonly sendgridApiKey?: string | null;
  readonly mailFrom?: string | null;
  // Closed network
  readonly closedNetworkMode?: boolean;
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

    // Email notifications via SendGrid are enabled only when both the API key
    // and sender address are provided and we are not in closed-network mode
    // (no internet egress to the SendGrid API).
    const notificationsEnabled =
      !props.closedNetworkMode && !!props.sendgridApiKey && !!props.mailFrom;

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
        ...(notificationsEnabled
          ? {
              SENDGRID_API_KEY: props.sendgridApiKey!,
              MAIL_FROM: props.mailFrom!,
            }
          : {}),
      },
      bundling: {
        nodeModules: [
          '@aws-sdk/client-bedrock-agentcore',
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
      },
      bundling: {
        nodeModules: ['@aws-sdk/client-scheduler'],
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
