import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Vpc,
  IVpc,
  SubnetType,
  SecurityGroup,
  IpAddresses,
} from 'aws-cdk-lib/aws-ec2';
import { UserPool, IUserPool } from 'aws-cdk-lib/aws-cognito';
import { AuthorizationSystem } from '../../construct/authorization/authorization-system';

/**
 * VPC Configuration for Authorization Stack
 */
export interface VpcConfig {
  /**
   * Create new VPC or use existing
   */
  readonly createNew: boolean;

  /**
   * VPC ID (required if createNew is false)
   */
  readonly vpcId?: string;

  /**
   * VPC CIDR block (required if createNew is true)
   * @default '10.1.0.0/16'
   */
  readonly vpcCidr?: string;

  /**
   * Maximum number of Availability Zones
   * @default 2
   */
  readonly maxAzs?: number;

  /**
   * Number of NAT Gateways
   * @default 1
   */
  readonly natGateways?: number;
}

/**
 * OpenFGA Service Configuration
 */
export interface OpenFgaConfig {
  /**
   * OpenFGA container image tag
   * @default 'latest'
   */
  readonly imageTag?: string;

  /**
   * CPU units for Fargate task
   * @default 256
   */
  readonly cpu?: number;

  /**
   * Memory in MB for Fargate task
   * @default 512
   */
  readonly memoryLimitMiB?: number;

  /**
   * Desired number of Fargate tasks
   * @default 2
   */
  readonly desiredCount?: number;

  /**
   * Minimum number of tasks for autoscaling
   * @default 2
   */
  readonly minCapacity?: number;

  /**
   * Maximum number of tasks for autoscaling
   * @default 10
   */
  readonly maxCapacity?: number;

  /**
   * Enable playground (ONLY for development)
   * @default false
   */
  readonly enablePlayground?: boolean;
}

/**
 * Database Configuration
 */
export interface DatabaseConfig {
  /**
   * RDS instance type
   * @default 'db.t4g.micro'
   */
  readonly instanceType?: string;

  /**
   * Enable Multi-AZ deployment
   * @default false
   */
  readonly multiAz?: boolean;

  /**
   * Allocated storage in GB
   * @default 20
   */
  readonly allocatedStorageGb?: number;

  /**
   * Backup retention period in days
   * @default 7
   */
  readonly backupRetentionDays?: number;

  /**
   * Enable deletion protection
   * @default false
   */
  readonly deletionProtection?: boolean;
}

/**
 * Authorizer Configuration
 */
export interface AuthorizerConfig {
  /**
   * Enable authorization cache
   * @default true
   */
  readonly enableCache?: boolean;

  /**
   * Cache TTL in seconds
   * @default 300
   */
  readonly cacheTTLSeconds?: number;
}

/**
 * Authorization Stack Props
 */
export interface AuthorizationStackProps extends cdk.StackProps {
  /**
   * Environment name for resource naming
   */
  readonly environment: string;

  /**
   * Deployment ID for unique resource naming
   * Use this to deploy multiple authorization systems in same account
   * @default 'default'
   */
  readonly deploymentId?: string;

  /**
   * VPC configuration
   */
  readonly vpcConfig: VpcConfig;

  /**
   * OpenFGA service configuration
   */
  readonly openFgaConfig?: OpenFgaConfig;

  /**
   * Database configuration
   */
  readonly databaseConfig?: DatabaseConfig;

  /**
   * Authorizer configuration
   */
  readonly authorizerConfig?: AuthorizerConfig;

  /**
   * Cognito User Pool ID (optional)
   * If not provided, a new user pool will be created
   */
  readonly userPoolId?: string;

  /**
   * Cognito User Pool Client ID (optional)
   */
  readonly userPoolClientId?: string;
}

/**
 * Standalone Authorization Stack
 *
 * Deploys a complete authorization system that can be deployed independently
 * to any AWS account. Includes:
 * - VPC (new or existing)
 * - OpenFGA Database (RDS PostgreSQL)
 * - OpenFGA Service (ECS Fargate)
 * - Lambda Authorizer
 * - Cognito User Pool (optional)
 */
export class AuthorizationStack extends cdk.Stack {
  /**
   * VPC for the authorization system
   */
  public readonly vpc: IVpc;

  /**
   * Authorization system construct
   */
  public readonly authorizationSystem: AuthorizationSystem;

  /**
   * Cognito User Pool
   */
  public readonly userPool: IUserPool;

  constructor(scope: Construct, id: string, props: AuthorizationStackProps) {
    super(scope, id, props);

    const deploymentId = props.deploymentId ?? 'default';
    const environment = props.environment;

    // ========================================================================
    // VPC Setup
    // ========================================================================
    if (props.vpcConfig.createNew) {
      // Create new VPC
      this.vpc = new Vpc(this, 'Vpc', {
        ipAddresses: IpAddresses.cidr(props.vpcConfig.vpcCidr ?? '10.1.0.0/16'),
        maxAzs: props.vpcConfig.maxAzs ?? 2,
        natGateways: props.vpcConfig.natGateways ?? 1,
        subnetConfiguration: [
          {
            name: 'Public',
            subnetType: SubnetType.PUBLIC,
            cidrMask: 24,
          },
          {
            name: 'Private',
            subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            cidrMask: 24,
          },
        ],
      });

      // Tag VPC
      cdk.Tags.of(this.vpc).add('Name', `authz-${environment}-${deploymentId}`);
      cdk.Tags.of(this.vpc).add('Environment', environment);
      cdk.Tags.of(this.vpc).add('DeploymentId', deploymentId);
    } else {
      // Import existing VPC
      if (!props.vpcConfig.vpcId) {
        throw new Error('vpcId is required when createNew is false');
      }

      this.vpc = Vpc.fromLookup(this, 'Vpc', {
        vpcId: props.vpcConfig.vpcId,
      });
    }

    // ========================================================================
    // Cognito User Pool
    // ========================================================================
    if (props.userPoolId) {
      // Import existing User Pool
      this.userPool = UserPool.fromUserPoolId(
        this,
        'UserPool',
        props.userPoolId
      );
    } else {
      // Create new User Pool
      this.userPool = new UserPool(this, 'UserPool', {
        userPoolName: `authz-${environment}-${deploymentId}`,
        selfSignUpEnabled: false,
        signInAliases: {
          email: true,
          username: true,
        },
        autoVerify: {
          email: true,
        },
        passwordPolicy: {
          minLength: 8,
          requireLowercase: true,
          requireUppercase: true,
          requireDigits: true,
          requireSymbols: true,
        },
        accountRecovery: cdk.aws_cognito.AccountRecovery.EMAIL_ONLY,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      });

      // Create User Pool Client
      this.userPool.addClient('UserPoolClient', {
        userPoolClientName: `authz-${environment}-${deploymentId}-client`,
        authFlows: {
          userPassword: true,
          userSrp: true,
        },
        generateSecret: false,
      });

      // Tag User Pool
      cdk.Tags.of(this.userPool).add('Environment', environment);
      cdk.Tags.of(this.userPool).add('DeploymentId', deploymentId);
    }

    // ========================================================================
    // Authorization System
    // ========================================================================
    this.authorizationSystem = new AuthorizationSystem(
      this,
      'AuthorizationSystem',
      {
        userPool: this.userPool,
        userPoolClientId: props.userPoolClientId,
        vpc: this.vpc,
        environment: environment,
        enableCache: props.authorizerConfig?.enableCache ?? true,
        cacheTTLSeconds: props.authorizerConfig?.cacheTTLSeconds ?? 300,
        enablePlayground: props.openFgaConfig?.enablePlayground ?? false,
        openFgaImageTag: props.openFgaConfig?.imageTag,
        multiAz: props.databaseConfig?.multiAz ?? false,
        deletionProtection: props.databaseConfig?.deletionProtection ?? false,
      }
    );

    // ========================================================================
    // Stack Outputs
    // ========================================================================
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID for authorization system',
      exportName: `authz-${environment}-${deploymentId}-vpc-id`,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `authz-${environment}-${deploymentId}-user-pool-id`,
    });

    new cdk.CfnOutput(this, 'OpenFgaEndpoint', {
      value: this.authorizationSystem.openFgaEndpoint,
      description: 'OpenFGA HTTP endpoint',
      exportName: `authz-${environment}-${deploymentId}-openfga-endpoint`,
    });

    new cdk.CfnOutput(this, 'OpenFgaSecretArn', {
      value: this.authorizationSystem.openFgaSecret.secretArn,
      description: 'OpenFGA pre-shared keys secret ARN',
      exportName: `authz-${environment}-${deploymentId}-openfga-secret-arn`,
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.authorizationSystem.openFgaDatabase.instance.dbInstanceEndpointAddress,
      description: 'PostgreSQL database endpoint',
      exportName: `authz-${environment}-${deploymentId}-db-endpoint`,
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.authorizationSystem.openFgaDatabase.credentialsSecret.secretArn,
      description: 'Database credentials secret ARN',
      exportName: `authz-${environment}-${deploymentId}-db-secret-arn`,
    });

    new cdk.CfnOutput(this, 'AuthorizerFunctionArn', {
      value: this.authorizationSystem.authorizerFunction.functionArn,
      description: 'Lambda Authorizer function ARN',
      exportName: `authz-${environment}-${deploymentId}-authorizer-arn`,
    });

    // Tag all resources in the stack
    cdk.Tags.of(this).add('Stack', 'AuthorizationStack');
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('DeploymentId', deploymentId);
  }
}
