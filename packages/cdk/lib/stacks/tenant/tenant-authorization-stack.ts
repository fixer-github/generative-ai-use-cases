import * as cdk from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { IUserPool, UserPool } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { AuthorizationSystem } from '../../construct/authorization/authorization-system';

export interface TenantAuthorizationStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * VPC for authorization system resources
   * This should be the tenant's VPC to avoid cross-VPC communication overhead
   */
  readonly vpc: IVpc;

  /**
   * Cognito User Pool ID
   * Required for JWT verification in the Lambda Authorizer
   */
  readonly userPoolId: string;

  /**
   * Cognito User Pool Client ID (optional)
   * If not provided, client ID validation will be skipped when verifying access tokens
   */
  readonly userPoolClientId?: string;

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

  /**
   * Enable OpenFGA playground (for development only)
   * @default false
   */
  readonly enablePlayground?: boolean;

  /**
   * OpenFGA container image tag
   * @default 'latest'
   */
  readonly openFgaImageTag?: string;

  /**
   * Multi-AZ deployment for OpenFGA database
   * @default false (true for production)
   */
  readonly multiAz?: boolean;

  /**
   * Enable deletion protection for OpenFGA database
   * @default true
   */
  readonly deletionProtection?: boolean;

  /**
   * Removal policy for development environments
   * @default false (RETAIN)
   */
  readonly removalPolicy?: boolean;
}

/**
 * Stack that creates authorization system for a tenant
 *
 * This stack deploys a dedicated OpenFGA-based authorization system
 * in the tenant's VPC to avoid cross-VPC communication overhead.
 *
 * Includes:
 * - OpenFGA Service (ECS Fargate)
 * - PostgreSQL RDS Database
 * - Lambda Authorizer for API Gateway
 * - Plan/Quota tracking schema
 */
export class TenantAuthorizationStack extends cdk.Stack {
  /**
   * The authorization system construct
   */
  public readonly authorizationSystem: AuthorizationSystem;

  /**
   * The Cognito User Pool (imported)
   */
  public readonly userPool: IUserPool;

  /**
   * OpenFGA HTTP endpoint URL
   */
  public readonly openFgaEndpoint: string;

  /**
   * Lambda Authorizer function ARN
   */
  public readonly authorizerFunctionArn: string;

  constructor(scope: Construct, id: string, props: TenantAuthorizationStackProps) {
    super(scope, id, props);

    // Import Cognito User Pool
    this.userPool = UserPool.fromUserPoolId(
      this,
      'UserPool',
      props.userPoolId
    );

    // Create Authorization System in the tenant's VPC
    this.authorizationSystem = new AuthorizationSystem(
      this,
      'AuthorizationSystem',
      {
        userPool: this.userPool,
        userPoolClientId: props.userPoolClientId,
        vpc: props.vpc,
        environment: props.environment,
        enableCache: props.enableCache ?? true,
        cacheTTLSeconds: props.cacheTTLSeconds ?? 300,
        enablePlayground: props.enablePlayground ?? false,
        openFgaImageTag: props.openFgaImageTag,
        multiAz: props.multiAz ?? false,
        deletionProtection: props.deletionProtection ?? true,
      }
    );

    // Store endpoint for easy access
    this.openFgaEndpoint = this.authorizationSystem.openFgaEndpoint;
    this.authorizerFunctionArn = this.authorizationSystem.authorizerFunction.functionArn;

    // ========================================================================
    // Stack Outputs
    // ========================================================================

    new cdk.CfnOutput(this, 'OpenFgaEndpoint', {
      value: this.openFgaEndpoint,
      description: `OpenFGA HTTP endpoint for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-OpenFgaEndpoint`,
    });

    new cdk.CfnOutput(this, 'OpenFgaGrpcEndpoint', {
      value: this.openFgaEndpoint.replace(':8080', ':8081'),
      description: `OpenFGA gRPC endpoint for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-OpenFgaGrpcEndpoint`,
    });

    new cdk.CfnOutput(this, 'OpenFgaSecretArn', {
      value: this.authorizationSystem.openFgaSecret.secretArn,
      description: `OpenFGA pre-shared keys secret ARN for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-OpenFgaSecretArn`,
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.authorizationSystem.openFgaDatabase.instance.dbInstanceEndpointAddress,
      description: `PostgreSQL database endpoint for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-DatabaseEndpoint`,
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.authorizationSystem.openFgaDatabase.credentialsSecret.secretArn,
      description: `Database credentials secret ARN for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-DatabaseSecretArn`,
    });

    new cdk.CfnOutput(this, 'AuthorizerFunctionArn', {
      value: this.authorizerFunctionArn,
      description: `Lambda Authorizer function ARN for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-AuthorizerFunctionArn`,
    });

    new cdk.CfnOutput(this, 'AuthorizerFunctionName', {
      value: this.authorizationSystem.authorizerFunction.functionName,
      description: `Lambda Authorizer function name for tenant ${props.tenantId}`,
      exportName: `${this.stackName}-AuthorizerFunctionName`,
    });

    // Add tags
    cdk.Tags.of(this).add('TenantId', props.tenantId);
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Purpose', 'TenantAuthorization');
    cdk.Tags.of(this).add('Stack', 'TenantAuthorizationStack');

    // Set stack description
    this.templateOptions.description =
      `Creates OpenFGA-based authorization system for tenant ${props.tenantId} in ${props.environment} environment`;
  }
}
