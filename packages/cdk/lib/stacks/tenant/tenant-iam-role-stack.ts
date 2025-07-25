import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { TenantIamRole } from '../../construct/tenant-iam-role';

export interface TenantIamRoleStackProps extends cdk.StackProps {
  /**
   * The identity provider ARN
   */
  readonly identityProviderArn?: string;

  /**
   * The audience/client ID
   */
  readonly audience?: string;

  /**
   * The tenant ID claim
   */
  readonly tenantIdClaim?: string;

  /**
   * Role name
   */
  readonly roleName?: string;
}

export class TenantIamRoleStack extends cdk.Stack {
  public readonly tenantIamRole: TenantIamRole;

  constructor(scope: Construct, id: string, props?: TenantIamRoleStackProps) {
    super(scope, id, props);

    // Create parameters if values not provided
    const identityProviderArn = props?.identityProviderArn || new cdk.CfnParameter(this, 'IdentityProviderArn', {
      description: 'ARN of the identity provider (e.g., Cognito User Pool ARN or OIDC provider ARN)',
      type: 'String',
    }).valueAsString;

    const audience = props?.audience || new cdk.CfnParameter(this, 'Audience', {
      description: 'Audience/Client ID for the identity provider',
      type: 'String',
    }).valueAsString;

    // Create the IAM role
    this.tenantIamRole = new TenantIamRole(this, 'TenantIamRole', {
      identityProviderArn,
      audience,
      tenantIdClaim: props?.tenantIdClaim,
      roleName: props?.roleName,
      description: 'IAM role for multi-tenant access using AssumeRoleWithWebIdentity',
    });

    // Example: Add a basic policy for CloudWatch Logs
    this.tenantIamRole.addToPolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:/aws/tenant/*`],
    }));

    // Stack description
    this.templateOptions.description = 'Creates an IAM role that can be assumed using AssumeRoleWithWebIdentity for multi-tenant access';
  }
}