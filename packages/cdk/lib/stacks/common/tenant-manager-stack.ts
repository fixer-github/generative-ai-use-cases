import { Stack, StackProps } from 'aws-cdk-lib';
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

    this.tenantManager = tenantManager;
  }
}

export default TenantManagerStack;
