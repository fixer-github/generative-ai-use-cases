import { Construct } from 'constructs';
import {
  Role,
  WebIdentityPrincipal,
  PolicyStatement,
  Effect,
} from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';

export interface MultiTenantRoleProps {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly region: string;
  readonly account: string;
}

export class MultiTenantRole extends Construct {
  readonly role: Role;

  constructor(scope: Construct, id: string, props: MultiTenantRoleProps) {
    super(scope, id);

    // Get the OIDC provider ARN from the user pool
    const oidcProviderArn = Stack.of(this).formatArn({
      service: 'iam',
      region: '',
      account: props.account,
      resource: 'oidc-provider',
      resourceName: `cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}`,
    });

    // Create the single role for multi-tenant access
    this.role = new Role(this, 'MultiTenantAccessRole', {
      assumedBy: new WebIdentityPrincipal(oidcProviderArn, {
        StringEquals: {
          [`cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}:aud`]:
            props.userPoolClient.userPoolClientId,
        },
        'ForAnyValue:StringLike': {
          [`cognito-idp.${props.region}.amazonaws.com/${props.userPool.userPoolId}:amr`]:
            'authenticated',
        },
      }),
      description:
        'Single role for multi-tenant resource access with dynamic tenant ID',
    });

    // Grant the ability to tag sessions
    this.role.assumeRolePolicy?.addStatements(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [new WebIdentityPrincipal(oidcProviderArn)],
        actions: ['sts:TagSession'],
      })
    );

    // Add a sample policy that demonstrates tenant-based resource access
    // This will be expanded based on specific resource requirements
    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [`arn:aws:s3:::*-tenant-$\{aws:PrincipalTag/TenantID}/*`],
        conditions: {
          StringEquals: {
            'aws:PrincipalTag/TenantID': '${aws:PrincipalTag/TenantID}',
          },
        },
      })
    );

    // Add DynamoDB access policy with tenant isolation
    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
        ],
        resources: ['*'],
        conditions: {
          'ForAllValues:StringEquals': {
            'dynamodb:LeadingKeys': ['${aws:PrincipalTag/TenantID}'],
          },
        },
      })
    );

    // Add Bedrock access with tenant context
    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'aws:RequestTag/TenantID': '${aws:PrincipalTag/TenantID}',
          },
        },
      })
    );
  }
}
