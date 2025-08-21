import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';

export type BackendWebSocketApiProps = {
  // Context Params
  readonly region: string;
  readonly account: string;

  // Resource
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly userPoolClient: UserPoolClient;
  readonly connectionsTable: dynamodb.Table;
  readonly fileBucket: s3.Bucket;
};

export class WSApi extends Construct {
  readonly stage: apigatewayv2.WebSocketStage;
  readonly predictStreamFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: BackendWebSocketApiProps) {
    super(scope, id);

    const {
      region,
      account,
      userPool,
      idPool,
      userPoolClient,
      connectionsTable,
      fileBucket,
    } = props;

    // 接続
    const connectFunction = new NodejsFunction(this, 'ConnectWebSocket', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/connectWebSocket.ts',
    });
    connectFunction.grantInvoke(idPool.authenticatedRole);
    connectionsTable.grantWriteData(connectFunction);

    // 切断
    const disconnectFunction = new NodejsFunction(this, 'DisconnectWebSocket', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/disconnectWebSocket.ts',
    });
    disconnectFunction.grantInvoke(idPool.authenticatedRole);
    connectionsTable.grantWriteData(disconnectFunction);

    const predictStreamFunction = new NodejsFunction(this, 'PredictStream', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/predictStream.ts',
      timeout: Duration.minutes(15),
      memorySize: 256,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      },
      bundling: {
        nodeModules: [
          // TODO: ここに後で追加する
        ],
      },
    });
    connectionsTable.grantReadData(predictStreamFunction);
    fileBucket.grantReadWrite(predictStreamFunction);
    predictStreamFunction.grantInvoke(idPool.authenticatedRole);

    const defaultFunction = new NodejsFunction(this, 'DefaultFunction', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/webSocketHandler.ts',
    });

    // Create WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      connectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          connectFunction
        ),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          disconnectFunction
        ),
      },
      defaultRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'DefaultIntegration',
          defaultFunction
        ),
      },
    });

    // Add sendmessage route
    webSocketApi.addRoute('predictStream', {
      integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
        'PredictStreamIntegration',
        predictStreamFunction
      ),
    });

    // Create WebSocket Stage
    const stage = new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant permissions for managing connections to SendMessageHandler
    predictStreamFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${region}:${account}:${webSocketApi.apiId}/*/POST/@connections/*`,
        ],
      })
    );

    // Grant permissions for managing connections to DefaultHandler
    defaultFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${region}:${account}:${webSocketApi.apiId}/*/POST/@connections/*`,
          `arn:aws:execute-api:${region}:${account}:${webSocketApi.apiId}/*/GET/@connections/*`,
        ],
      })
    );

    this.stage = stage;
    this.predictStreamFunction = predictStreamFunction;
  }
}
