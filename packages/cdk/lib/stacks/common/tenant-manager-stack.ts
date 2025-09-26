import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { ProcessedStackInput } from '../../stack-input';
import { Construct } from 'constructs';
import { TenantManager } from '../../construct';

interface TenantManagerStackProps extends StackProps {
  params: ProcessedStackInput;
}

class TenantManagerStack extends Stack {
  readonly tenantManager: TenantManager;

  constructor(scope: Construct, id: string, props: TenantManagerStackProps) {
    super(scope, id, props);

    const { params } = props;

    // Tenant Management
    const tenantManager = new TenantManager(this, 'TenantManager', {
      environment: params.env,
      enableAutoDelete: params.enableAutoDelete,
    });

    new CfnOutput(this, 'TenantsTableName', {
      value: tenantManager.tenantsTable.tableName,
      description: 'Name of the DynamoDB Tenants table',
    });

    new CfnOutput(this, 'TenantRegistrationLambdaArn', {
      value: tenantManager.registrationLambda.functionArn,
      description: 'ARN of the tenant registration Lambda function',
    });

    this.tenantManager = tenantManager;
  }
}

export default TenantManagerStack;
