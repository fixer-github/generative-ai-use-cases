import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs'; // Node.js ランタイム用の Lambda
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';

export class BIVisualizeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // --- Lambda 用 IAM Role ---
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'), // CloudWatch Logs への書き込み権限
      ],
    });

    // DynamoDB への Scan 権限、および CloudWatch PutMetricData 権限を付与
    const dynamoDbScanPolicy = new iam.PolicyStatement({
      actions: [ 'dynamodb:Query',
                 'dynamodb:Scan',
                 'cloudwatch:PutMetricData'],
      resources: ['*'],
    });
    lambdaRole.addToPolicy(dynamoDbScanPolicy);

    // Lambda 関数コードのパス
    // `./lambda` ディレクトリに index.mjs ファイルがあることを想定
    const lambdaCodePath = './lambda'; // Lambda コードがあるディレクトリ

    // --- Lambda Function ---
    const lambdaFunction = new lambda.NodejsFunction(this, 'DynamoDbScanLambda', {
      runtime: lambda.Runtime.NODEJS_24_X, // または適した Node.js ランタイム
      entry: `${lambdaCodePath}/getMetricsLambda.js`, // Lambda ハンドラファイル（ESM想定）
      handler: 'handler', // ファイル内で export しているハンドラ関数名
      role: lambdaRole,
      environment: {
        // Lambda 環境変数
        USER_REGISTRATION_TABLE_NAME: 'YOUR_DYNAMODB_TABLE_NAME', // ここを実際のテーブル名に置き換える
        TOKEN_USAGE_STATS_TABLE_NAME: 'date', // 例: 'eventTimestamp'
      }
    });

    // --- EventBridge Rule (1時間ごとのトリガー) ---
    const rule = new events.Rule(this, 'DynamoDbScanTrigger', {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)), // 1時間ごとに実行
    });

    // --- EventBridge Target (Lambda Function) ---
    rule.addTarget(new targets.LambdaFunction(lambdaFunction));

    // --- EventBridge 用 IAM Role (Lambda をターゲットにするために必要) ---
    // EventBridge が Lambda を起動するための IAM Role。
    const eventBridgeRole = new iam.Role(this, 'EventBridgeLambdaInvokeRole', {
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
    });
    // EventBridge が Lambda を起動する権限
    eventBridgeRole.addToPolicy(new iam.PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      resources: [lambdaFunction.functionArn],
    }));

    const lambdaTarget = new targets.LambdaFunction(lambdaFunction, {
      role: eventBridgeRole, // EventBridge が Lambda を Invoke するための IAM Role
    });
    rule.addTarget(lambdaTarget);

    // --- Output (Optional) ---
    new cdk.CfnOutput(this, 'LambdaFunctionName', { value: lambdaFunction.functionName });
    new cdk.CfnOutput(this, 'EventBridgeRuleName', { value: rule.ruleName });
  }
}