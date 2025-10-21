import { Duration } from 'aws-cdk-lib';
import { IVpc, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { DatabaseProxy, ProxyTarget } from 'aws-cdk-lib/aws-rds';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { OpenFGADatabase } from './openfga-database';

/**
 * OpenFGA RDS Proxy Props
 */
export interface OpenFGARDSProxyProps {
  /**
   * VPC for the RDS Proxy
   */
  readonly vpc: IVpc;

  /**
   * OpenFGA database instance
   */
  readonly database: OpenFGADatabase;

  /**
   * Environment name for resource naming
   */
  readonly environment: string;

  /**
   * Maximum connections per proxy
   * @default 100
   */
  readonly maxConnectionsPercent?: number;

  /**
   * Connection borrow timeout
   * @default 120 seconds
   */
  readonly maxIdleConnectionsPercent?: number;

  /**
   * Idle client timeout
   * @default 1800 seconds (30 minutes)
   */
  readonly connectionBorrowTimeout?: Duration;
}

/**
 * OpenFGA RDS Proxy Construct
 * OpenFGA用RDSプロキシコンストラクト
 *
 * Creates an RDS Proxy for the OpenFGA database to provide:
 * - Connection pooling for Lambda functions
 * - Reduced connection overhead
 * - Improved cold start performance
 * - Better resource utilization
 */
export class OpenFGARDSProxy extends Construct {
  /** RDS Proxy instance */
  public readonly proxy: DatabaseProxy;

  /** Proxy endpoint */
  public readonly endpoint: string;

  /** Proxy security group */
  public readonly securityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: OpenFGARDSProxyProps) {
    super(scope, id);

    // Create security group for RDS Proxy
    this.securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: `Security group for OpenFGA RDS Proxy (${props.environment})`,
      allowAllOutbound: true,
    });

    // Allow proxy to connect to database
    props.database.securityGroup.addIngressRule(
      this.securityGroup,
      props.database.connections.defaultPort!,
      'Allow RDS Proxy to access database'
    );

    // Create RDS Proxy
    this.proxy = new DatabaseProxy(this, 'Proxy', {
      proxyTarget: ProxyTarget.fromInstance(props.database.instance),
      secrets: [props.database.secret],
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [this.securityGroup],
      dbProxyName: `openfga-proxy-${props.environment}`,
      maxConnectionsPercent: props.maxConnectionsPercent ?? 100,
      maxIdleConnectionsPercent: props.maxIdleConnectionsPercent ?? 50,
      connectionBorrowTimeout: props.connectionBorrowTimeout ?? Duration.seconds(120),
      requireTLS: true,
      // Enable IAM authentication for additional security
      iamAuth: false, // Set to true if you want to use IAM authentication
    });

    this.endpoint = this.proxy.endpoint;
  }

  /**
   * Grant Lambda function access to the proxy
   */
  grantConnect(grantee: any, securityGroup: SecurityGroup): void {
    // Allow Lambda security group to connect to proxy
    this.securityGroup.addIngressRule(
      securityGroup,
      this.securityGroup.connections.defaultPort!,
      'Allow Lambda to connect to RDS Proxy'
    );

    // If IAM auth is enabled, grant connect permission
    if (this.proxy.grantConnect) {
      this.proxy.grantConnect(grantee);
    }
  }
}
