import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { GenericApiProps } from './props';
import { LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import {
  TABLE_PREFIX,
  STATS_TABLE_PREFIX,
  USER_SUMMARY_TABLE_PREFIX,
} from './const';
import { getBaseEnvironment } from './util';
import { Table } from 'aws-cdk-lib/aws-dynamodb';

export interface SummaryApiProps extends GenericApiProps {
  readonly userSummaryTable: Table;
}

class SummaryApi extends Construct {
  constructor(scope: Construct, id: string, props: SummaryApiProps) {
    super(scope, id);

    const {
      api,
      commonAuthorizerProps,
      tenantManager,
      userSummaryTable,
    } = props;

    const baseEnv = getBaseEnvironment(this, props, {
      STATS_TABLE_NAME: STATS_TABLE_PREFIX,
      DEFAULT_STATS_TABLE_NAME: props.statsTable.tableName,
      USER_SUMMARY_TABLE_NAME: USER_SUMMARY_TABLE_PREFIX,
      DEFAULT_USER_SUMMARY_TABLE_NAME: userSummaryTable.tableName,
    });

    // /summaries resource
    const summariesResource = api.root.addResource('summaries');

    // GET /summaries - Get user's summaries (daily + user profile)
    const getSummariesFunction = new NodejsFunction(this, 'GetSummaries', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getSummaries.ts',
      environment: baseEnv,
      timeout: Duration.seconds(30),
    });
    userSummaryTable.grantReadData(getSummariesFunction);

    summariesResource.addMethod(
      'GET',
      new LambdaIntegration(getSummariesFunction),
      commonAuthorizerProps
    );

    // /summaries/config resource
    const configResource = summariesResource.addResource('config');

    // PUT /summaries/config - Update user's summary configuration
    const updateConfigFunction = new NodejsFunction(this, 'UpdateConfig', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/updateSummaryConfig.ts',
      environment: baseEnv,
      timeout: Duration.seconds(30),
    });
    userSummaryTable.grantReadWriteData(updateConfigFunction);

    configResource.addMethod(
      'PUT',
      new LambdaIntegration(updateConfigFunction),
      commonAuthorizerProps
    );

    // Grant tenant manager access if multi-tenant
    if (tenantManager) {
      tenantManager.tenantsTable.grantReadData(getSummariesFunction);
      tenantManager.tenantsTable.grantReadData(updateConfigFunction);
    }
  }
}

export default SummaryApi;
