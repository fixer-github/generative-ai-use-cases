import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  IAuthorizer,
  MethodOptions,
  RequestAuthorizer,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { LAMBDA_RUNTIME_NODEJS } from '../../consts';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';

export interface ApiAuthorizerProps {
  readonly userPool: UserPool;
  readonly userPoolClientId: string;
  readonly identityPoolId?: string;
  readonly enableIamAuth?: boolean;
  readonly tenantRoleArn?: string;
}

export class ApiAuthorizer extends Construct {
  readonly cognitoAuthorizer: CognitoUserPoolsAuthorizer;
  readonly customAuthorizer?: IAuthorizer;
  readonly authorizerType: AuthorizationType;

  constructor(scope: Construct, id: string, props: ApiAuthorizerProps) {
    super(scope, id);

    // Always create Cognito authorizer for backward compatibility
    this.cognitoAuthorizer = new CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [props.userPool],
    });

    if (props.enableIamAuth) {
      // Create custom authorizer that validates both Cognito tokens and IAM signatures
      const authorizerFunction = new NodejsFunction(this, 'AuthorizerFunction', {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/apiAuthorizer.ts',
        timeout: Duration.seconds(30),
        environment: {
          USER_POOL_ID: props.userPool.userPoolId,
          USER_POOL_CLIENT_ID: props.userPoolClientId,
          IDENTITY_POOL_ID: props.identityPoolId || '',
          TENANT_ROLE_ARN: props.tenantRoleArn || '',
        },
      });

      // Grant permissions to validate tokens
      authorizerFunction.addToRolePolicy(new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:GetUser',
          'cognito-identity:GetCredentialsForIdentity',
          'sts:AssumeRoleWithWebIdentity',
        ],
        resources: ['*'],
      }));

      this.customAuthorizer = new RequestAuthorizer(this, 'CustomAuthorizer', {
        handler: authorizerFunction,
        resultsCacheTtl: Duration.minutes(5),
        identitySources: ['method.request.header.Authorization'],
      });

      this.authorizerType = AuthorizationType.CUSTOM;
    } else {
      this.authorizerType = AuthorizationType.COGNITO;
    }
  }

  /**
   * Get the appropriate method options based on configuration
   */
  getMethodOptions(): MethodOptions {
    if (this.authorizerType === AuthorizationType.CUSTOM) {
      return {
        authorizationType: AuthorizationType.CUSTOM,
        authorizer: this.customAuthorizer!,
      };
    }

    return {
      authorizationType: AuthorizationType.COGNITO,
      authorizer: this.cognitoAuthorizer,
    };
  }
}