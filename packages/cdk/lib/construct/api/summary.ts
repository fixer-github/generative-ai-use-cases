import { LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration } from 'aws-cdk-lib';
import { getBaseEnvironment } from './util';
import { GenericApiProps } from './props';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { USER_SUMMARY_TABLE_PREFIX } from './const';

export interface SummaryApiProps extends GenericApiProps {
  readonly userSummaryTable: Table;
}

/**
 * Summary API construct for user summary endpoints
 * - GET /summaries - Returns user's daily and user summaries
 * - PUT /summaries/config - Updates user's summary configuration
 */
class SummaryApi extends Construct {
  constructor(scope: Construct, id: string, props: SummaryApiProps) {
    super(scope, id);

    const { api, commonAuthorizerProps, userSummaryTable, tenantManager } =
      props;

    const summariesResource = api.root.addResource('summaries');

    // GET /summaries - Get user summaries
    const getSummariesFunction = new NodejsFunction(this, 'GetSummaries', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getSummaries.ts',
      timeout: Duration.seconds(30),
      environment: getBaseEnvironment(this, props, {
        USER_SUMMARY_TABLE_NAME: USER_SUMMARY_TABLE_PREFIX,
        DEFAULT_USER_SUMMARY_TABLE_NAME: userSummaryTable.tableName,
        TENANTS_TABLE_NAME: tenantManager?.tenantsTable.tableName || '',
      }),
    });

    // Grant read permissions
    userSummaryTable.grantReadData(getSummariesFunction);
    if (tenantManager) {
      tenantManager.tenantsTable.grantReadData(getSummariesFunction);
    }

    summariesResource.addMethod(
      'GET',
      new LambdaIntegration(getSummariesFunction),
      commonAuthorizerProps
    );

    // PUT /summaries/config - Update summary configuration
    const updateSummaryConfigFunction = new NodejsFunction(
      this,
      'UpdateSummaryConfig',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/updateSummaryConfig.ts',
        timeout: Duration.seconds(30),
        environment: getBaseEnvironment(this, props, {
          USER_SUMMARY_TABLE_NAME: USER_SUMMARY_TABLE_PREFIX,
          DEFAULT_USER_SUMMARY_TABLE_NAME: userSummaryTable.tableName,
          TENANTS_TABLE_NAME: tenantManager?.tenantsTable.tableName || '',
        }),
      }
    );

    // Grant read/write permissions for config updates
    userSummaryTable.grantReadWriteData(updateSummaryConfigFunction);
    if (tenantManager) {
      tenantManager.tenantsTable.grantReadData(updateSummaryConfigFunction);
    }

    const configResource = summariesResource.addResource('config');
    configResource.addMethod(
      'PUT',
      new LambdaIntegration(updateSummaryConfigFunction),
      commonAuthorizerProps
    );
  }
}

export default SummaryApi;
