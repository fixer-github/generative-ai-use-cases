import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface TenantVpcStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId?: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * CIDR block for the VPC
   * @default '10.0.0.0/16'
   */
  readonly vpcCidr?: string;

  /**
   * Number of availability zones
   * @default 2
   */
  readonly maxAzs?: number;

  /**
   * Number of NAT gateways
   * @default 1
   */
  readonly natGateways?: number;
}

export class TenantVpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: TenantVpcStackProps) {
    super(scope, id, props);

    // Create parameter if tenant ID not provided
    const tenantId =
      props?.tenantId ||
      new cdk.CfnParameter(this, 'TenantId', {
        description: 'The tenant identifier for the VPC',
        type: 'String',
        allowedPattern: '^[a-zA-Z0-9-]+$',
        constraintDescription:
          'Tenant ID must contain only alphanumeric characters and hyphens',
      }).valueAsString;

    // Get environment (required parameter)
    const environment = props.environment;

    // Create VPC
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(props.vpcCidr || '10.0.0.0/16'),
      maxAzs: props.maxAzs || 2,
      natGateways: props.natGateways || 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // Add VPC Flow Logs for security monitoring
    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: `VPC ID for tenant ${tenantId}`,
      exportName: `${this.stackName}-VpcId`,
    });

    new cdk.CfnOutput(this, 'VpcArn', {
      value: this.vpc.vpcArn,
      description: `VPC ARN for tenant ${tenantId}`,
      exportName: `${this.stackName}-VpcArn`,
    });

    // Export private subnet IDs
    const privateSubnetIds = this.vpc.privateSubnets.map(
      (subnet) => subnet.subnetId
    );
    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: cdk.Fn.join(',', privateSubnetIds),
      description: `Private subnet IDs for tenant ${tenantId}`,
      exportName: `${this.stackName}-PrivateSubnetIds`,
    });

    // Export public subnet IDs
    const publicSubnetIds = this.vpc.publicSubnets.map(
      (subnet) => subnet.subnetId
    );
    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: cdk.Fn.join(',', publicSubnetIds),
      description: `Public subnet IDs for tenant ${tenantId}`,
      exportName: `${this.stackName}-PublicSubnetIds`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', tenantId.toString());
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Purpose', 'TenantVpc');

    // Set stack description
    this.templateOptions.description = `Creates VPC and network infrastructure for tenant ${tenantId}`;
  }
}
