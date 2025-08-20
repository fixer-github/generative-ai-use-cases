import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { Duration } from 'aws-cdk-lib';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

export interface BackendWebSocketApiProps {
  //
}

export class WSApi extends Construct {
  readonly webSocketApi: WebSocketApi;
  readonly stage;

  constructor(scope: Construct, id: string, props: BackendWebSocketApiProps) {
    super(scope, id);

    // 接続
    const connectWebSocketFunction = new NodejsFunction(
      this,
      'ConnectWebSocket',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/connectWebSocket.ts',
      }
    );

    // 切断
    const disconnectWebSocketFunction = new NodejsFunction(
      this,
      'DisconnectWebSocket',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/disconnectWebSocket.ts',
      }
    );

    // 処理本体
    const predictStreamFunction = new NodejsFunction(this, 'PredictStream', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/PredictStream.ts',
      timeout: Duration.minutes(15),
      memorySize: 256,
    });

    // WebSocketのAPI本体
    const webSocketApi = new WebSocketApi(this, 'webSocketApi', {
      apiName: 'PredictStream',
    });

    // ルートとインテグレーションの設定
    webSocketApi.addRoute('$connect', {
      integration: new WebSocketLambdaIntegration(
        'ConnectWebSocket',
        connectWebSocketFunction
      ),
    });

    webSocketApi.addRoute('$disconnect', {
      integration: new WebSocketLambdaIntegration(
        'DisconnectWebSocket',
        disconnectWebSocketFunction
      ),
    });

    const stage = new WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    this.webSocketApi = webSocketApi;
    this.stage = stage;
  }
}
