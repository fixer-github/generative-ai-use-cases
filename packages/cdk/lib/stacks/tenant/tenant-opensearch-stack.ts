import * as cdk from 'aws-cdk-lib';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface OpenSearchCapacityConfig {
  dataNodes: number;
  dataNodeInstanceType: string;
  masterNodes?: number;
  masterNodeInstanceType?: string;
  warmNodes?: number;
  warmNodeInstanceType?: string;
}

export interface TenantOpenSearchStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId?: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * VPC for OpenSearch domain
   */
  readonly vpc: ec2.IVpc;

  /**
   * OpenSearch capacity configuration (JSON string)
   */
  readonly opensearchCapacity?: string;

  /**
   * OpenSearch version
   * @default OPENSEARCH_2_11
   */
  readonly opensearchVersion?: opensearch.EngineVersion;

  /**
   * Enable fine-grained access control
   * @default true
   */
  readonly enableFineGrainedAccessControl?: boolean;

  /**
   * Master user ARN for fine-grained access control
   */
  readonly masterUserArn?: string;

  /**
   * Enable node-to-node encryption
   * @default true
   */
  readonly nodeToNodeEncryption?: boolean;

  /**
   * Enable encryption at rest
   * @default true
   */
  readonly encryptionAtRest?: boolean;

  /**
   * Removal policy for the domain
   */
  readonly removalPolicy?: cdk.RemovalPolicy;
}

export class TenantOpenSearchStack extends cdk.Stack {
  public readonly domain: opensearch.Domain;
  public readonly domainEndpoint: string;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: TenantOpenSearchStackProps) {
    super(scope, id, props);

    // Create parameter if tenant ID not provided
    const tenantId =
      props?.tenantId ||
      new cdk.CfnParameter(this, 'TenantId', {
        description: 'The tenant identifier for OpenSearch',
        type: 'String',
        allowedPattern: '^[a-zA-Z0-9-]+$',
        constraintDescription:
          'Tenant ID must contain only alphanumeric characters and hyphens',
      }).valueAsString;

    const environment = props.environment;

    // Parse capacity configuration
    let capacityConfig: opensearch.CapacityConfig | undefined;
    if (props.opensearchCapacity) {
      try {
        const parsedConfig = JSON.parse(
          props.opensearchCapacity
        ) as OpenSearchCapacityConfig;

        // Validate instance types (exclude EBS-incompatible and ultrawarm types)
        const invalidInstanceTypes = ['i3.', 'i3en.', 'ultrawarm1.'];
        const validateInstanceType = (instanceType: string) => {
          for (const invalid of invalidInstanceTypes) {
            if (instanceType.includes(invalid)) {
              throw new Error(
                `Instance type ${instanceType} is not supported. EBS-incompatible (i3.*, i3en.*) and ultrawarm (ultrawarm1.*) instance types are not allowed.`
              );
            }
          }
        };

        validateInstanceType(parsedConfig.dataNodeInstanceType);
        if (parsedConfig.masterNodeInstanceType) {
          validateInstanceType(parsedConfig.masterNodeInstanceType);
        }

        capacityConfig = {
          dataNodes: parsedConfig.dataNodes,
          dataNodeInstanceType: parsedConfig.dataNodeInstanceType,
          masterNodes: parsedConfig.masterNodes,
          masterNodeInstanceType: parsedConfig.masterNodeInstanceType,
          warmNodes: parsedConfig.warmNodes,
          warmInstanceType: parsedConfig.warmNodeInstanceType,
        };
      } catch (error) {
        throw new Error(
          `Failed to parse OpenSearch capacity configuration: ${error}`
        );
      }
    } else {
      // Default configuration
      capacityConfig = {
        dataNodes: 2,
        dataNodeInstanceType: 't3.small.search',
      };
    }

    // Create security group for OpenSearch
    this.securityGroup = new ec2.SecurityGroup(
      this,
      'OpenSearchSecurityGroup',
      {
        vpc: props.vpc,
        description: `Security group for OpenSearch domain - tenant ${tenantId}`,
        allowAllOutbound: true,
      }
    );

    // Allow HTTPS access within VPC
    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS access from within VPC'
    );

    // Select private subnets for OpenSearch domain
    const subnets = props.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });

    // Create OpenSearch domain
    this.domain = new opensearch.Domain(this, 'Domain', {
      version:
        props.opensearchVersion || opensearch.EngineVersion.OPENSEARCH_2_11,
      capacity: capacityConfig,
      vpcOptions: {
        subnets: subnets.subnets.slice(0, 2), // OpenSearch supports max 2 AZs for non-3AZ configurations
        securityGroups: [this.securityGroup],
      },
      nodeToNodeEncryption: props.nodeToNodeEncryption !== false,
      encryptionAtRest: {
        enabled: props.encryptionAtRest !== false,
      },
      fineGrainedAccessControl:
        props.enableFineGrainedAccessControl !== false
          ? {
              masterUserArn: props.masterUserArn,
            }
          : undefined,
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true,
        slowIndexLogEnabled: true,
      },
      removalPolicy: props.removalPolicy || cdk.RemovalPolicy.RETAIN,
      domainName: `tenant-${tenantId}-${environment}`
        .toLowerCase()
        .substring(0, 28), // OpenSearch domain name max 28 chars
    });

    // Store the endpoint for easy access
    this.domainEndpoint = this.domain.domainEndpoint;

    // Grant access to Bedrock service principal
    this.domain.grantWrite(new iam.ServicePrincipal('bedrock.amazonaws.com'));

    // Outputs
    new cdk.CfnOutput(this, 'DomainEndpoint', {
      value: this.domain.domainEndpoint,
      description: `OpenSearch domain endpoint for tenant ${tenantId}`,
      exportName: `${this.stackName}-DomainEndpoint`,
    });

    new cdk.CfnOutput(this, 'DomainArn', {
      value: this.domain.domainArn,
      description: `OpenSearch domain ARN for tenant ${tenantId}`,
      exportName: `${this.stackName}-DomainArn`,
    });

    new cdk.CfnOutput(this, 'SecurityGroupId', {
      value: this.securityGroup.securityGroupId,
      description: `Security group ID for OpenSearch domain - tenant ${tenantId}`,
      exportName: `${this.stackName}-SecurityGroupId`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', tenantId.toString());
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Purpose', 'ManagedOpenSearch');

    // Set stack description
    this.templateOptions.description = `Creates managed OpenSearch domain for tenant ${tenantId}`;
  }
}
