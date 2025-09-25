import { Construct } from 'constructs';
import { GenericApiProps } from './props';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Duration } from 'aws-cdk-lib';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';

export type InvokeFlowApiProps = GenericApiProps;

class InvokeFlowApi extends Construct {
  readonly invokeFlowFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: InvokeFlowApiProps) {
    super(scope, id);

    const {
      modelRegion,
      tenantManager,
      idPool,
      sagemakerPolicy,
      bedrockPolicy,
      litellmProxy,
    } = props;

    // Add Flow Lambda Function
    const invokeFlowFunction = new NodejsFunction(this, 'InvokeFlow', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/invokeFlow.ts',
      timeout: Duration.minutes(15),
      bundling: {
        nodeModules: [
          '@aws-sdk/client-bedrock-runtime',
          '@aws-sdk/client-bedrock-agent-runtime',
        ],
      },
      environment: {
        MODEL_REGION: modelRegion,

        // Tenant Management Environment Variables
        ...(tenantManager
          ? {
              TENANTS_TABLE_NAME: tenantManager.tenantsTable.tableName,
            }
          : {}),
      },
    });

    // Add resource-based policy to allow invocation by authenticated identity pool users
    // This avoids circular dependencies between stacks
    invokeFlowFunction.addPermission('AllowAuthenticatedInvoke', {
      principal: new ServicePrincipal('cognito-identity.amazonaws.com'),
      action: 'lambda:InvokeFunction',
    });

    if (tenantManager) {
      tenantManager.tenantsTable.grantReadData(invokeFlowFunction);
    }
    if (sagemakerPolicy) {
      invokeFlowFunction.role?.addToPrincipalPolicy(sagemakerPolicy);
    }
    if (litellmProxy) {
      litellmProxy.grantInvokeUrl(invokeFlowFunction);
    }
    if (bedrockPolicy) {
      invokeFlowFunction.role?.addToPrincipalPolicy(bedrockPolicy);
    }

    this.invokeFlowFunction = invokeFlowFunction;
  }
}

export default InvokeFlowApi;
