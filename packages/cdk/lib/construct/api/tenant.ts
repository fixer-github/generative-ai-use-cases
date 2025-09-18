import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { getBaseEnvironment } from './util';
import { GenericApiProps } from './props';

export type TenantApiProps = GenericApiProps;

class TenantApi extends Construct {
  constructor(scope: Construct, id: string, props: TenantApiProps) {
    super(scope, id);

    const { api, commonAuthorizerProps, tenantManager, userPoolClient } = props;

    if (!tenantManager) {
      throw new Error('Tenant API requires tenant manager configuration');
    }

    const getTenantConfigFunction = new NodejsFunction(
      this,
      'GetTenantConfig',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/getTenantConfig.ts',
        timeout: Duration.seconds(30),
        bundling: {
          nodeModules: ['aws-jwt-verify'],
        },
        environment: getBaseEnvironment(this, props, {
          USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        }),
      }
    );

    tenantManager.tenantsTable.grantReadData(getTenantConfigFunction);

    const tenantsResource = api.root.addResource('tenants');
    const configResource = tenantsResource.addResource('config');

    configResource.addMethod(
      'GET',
      new LambdaIntegration(getTenantConfigFunction),
      commonAuthorizerProps
    );
  }
}

export default TenantApi;

