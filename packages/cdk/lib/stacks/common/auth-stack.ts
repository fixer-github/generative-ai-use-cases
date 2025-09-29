import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { Construct } from 'constructs';
import { ProcessedStackInput } from '../../stack-input';
import Auth from '../../construct/auth';
import { CognitoUserPoolsAuthorizer } from 'aws-cdk-lib/aws-apigateway';

interface AuthStackProps extends StackProps {
  readonly params: ProcessedStackInput;
}

class AuthStack extends Stack {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly idPool: IdentityPool;
  readonly authorizer: CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { params } = props;

    const auth = new Auth(this, 'Auth', {
      samlAuthEnabled: params.samlAuthEnabled,
      samlDefaultAuthEnabled: params.samlDefaultAuthEnabled,
      selfSignUpEnabled: params.selfSignUpEnabled,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
    });

    const userPool = auth.userPool;
    const client = auth.client;
    const idPool = auth.idPool;

    const authorizer = new CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
    });

    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });

    new CfnOutput(this, 'UserPoolClientId', {
      value: client.userPoolClientId,
    });

    new CfnOutput(this, 'IdPoolId', { value: idPool.identityPoolId });

    this.client = client;
    this.userPool = userPool;
    this.idPool = idPool;
    this.authorizer = authorizer;
  }
}

export default AuthStack;
