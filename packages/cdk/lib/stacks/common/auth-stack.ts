import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Auth } from '../../construct';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { ProcessedStackInput } from '../../stack-input';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';

export interface AuthStackProps extends StackProps {
  readonly params: ProcessedStackInput;
}

export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly idPool: IdentityPool;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const params = props.params;

    const auth = new Auth(this, 'Auth', {
      selfSignUpEnabled: params.selfSignUpEnabled,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      selfSignUpTenantMap: params.selfSignUpTenantMap,
      samlAuthEnabled: params.samlAuthEnabled,
      samlDefaultAuthEnabled: params.samlDefaultAuthEnabled,
    });

    this.userPool = auth.userPool;
    this.userPoolClient = auth.client;
    this.idPool = auth.idPool;

    new CfnOutput(this, 'UserPoolId', {
      value: auth.userPool.userPoolId,
      exportName: `${this.stackName}-UserPoolId`,
    });

    new CfnOutput(this, 'UserPoolClientId', {
      value: auth.client.userPoolClientId,
      exportName: `${this.stackName}-UserPoolClientId`,
    });

    new CfnOutput(this, 'IdPoolId', {
      value: auth.idPool.identityPoolId,
      exportName: `${this.stackName}-IdPoolId`,
    });
  }
}
