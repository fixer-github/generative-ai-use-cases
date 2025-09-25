import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Auth } from '../../construct';
import { ProcessedStackInput } from '../../stack-input';

export interface AuthenticationStackProps extends StackProps {
  readonly params: ProcessedStackInput;
}

export class AuthenticationStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly idPoolId: string;
  public readonly auth: Auth;

  constructor(scope: Construct, id: string, props: AuthenticationStackProps) {
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
    this.idPoolId = auth.idPool.identityPoolId;
    this.auth = auth;

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
