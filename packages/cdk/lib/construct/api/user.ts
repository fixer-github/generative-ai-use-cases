import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration, Stack } from 'aws-cdk-lib';
import { getBaseEnvironment } from './util';
import { GenericApiProps } from './props';
import { LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Table } from 'aws-cdk-lib/aws-dynamodb';

export interface UserApiProps extends GenericApiProps {
  readonly userRegistrationMetadataTable?: Table;
}

class UserApi extends Construct {
  constructor(scope: Construct, id: string, props: UserApiProps) {
    super(scope, id);

    const { api, userPool, commonAuthorizerProps, userPoolClient } = props;

    // Lambda function for deleting own account
    const deleteOwnAccountFunction = new NodejsFunction(
      this,
      'DeleteOwnAccount',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/deleteOwnAccount.ts',
        timeout: Duration.minutes(2),
        bundling: {
          nodeModules: ['aws-jwt-verify'],
        },
        environment: getBaseEnvironment(this, props, {
          USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        }),
      }
    );

    // Grant Cognito delete permission
    deleteOwnAccountFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:AdminDeleteUser'],
        resources: [userPool.userPoolArn],
      })
    );

    // API routes
    const userResource = api.root.addResource('user');
    const accountResource = userResource.addResource('account');

    // DELETE /user/account - Delete own account
    accountResource.addMethod(
      'DELETE',
      new LambdaIntegration(deleteOwnAccountFunction),
      commonAuthorizerProps
    );

    // Lambda function for setting birthdate
    // テーブル名を環境変数から構築（auth.tsと同じ命名規則）
    const userRegistrationMetadataTableName = props.userRegistrationMetadataTable
      ? props.userRegistrationMetadataTable.tableName
      : props.environment
        ? `UserRegistrationMetadata-${props.environment}`
        : 'UserRegistrationMetadata';

    const setBirthdateFunction = new NodejsFunction(
      this,
      'SetBirthdate',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/setBirthdate.ts',
        timeout: Duration.minutes(1),
        bundling: {
          nodeModules: ['aws-jwt-verify'],
        },
        environment: getBaseEnvironment(this, props, {
          USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
          USER_REGISTRATION_METADATA_TABLE_NAME: userRegistrationMetadataTableName,
        }),
      }
    );

    // Grant DynamoDB write permission
    if (props.userRegistrationMetadataTable) {
      props.userRegistrationMetadataTable.grantWriteData(setBirthdateFunction);
    } else {
      // テーブル参照がない場合は、テーブル名ベースで権限を付与
      const stack = Stack.of(this);
      setBirthdateFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'dynamodb:UpdateItem',
            'dynamodb:PutItem',
          ],
          resources: [
            `arn:aws:dynamodb:${stack.region}:${stack.account}:table/${userRegistrationMetadataTableName}`,
          ],
        })
      );
    }

    // Grant Cognito permission to update user attributes (birthdate)
    setBirthdateFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cognito-idp:AdminUpdateUserAttributes'],
        resources: [userPool.userPoolArn],
      })
    );

    // PUT /user/birthdate - Set birthdate
    const birthdateResource = userResource.addResource('birthdate');
    birthdateResource.addMethod(
      'PUT',
      new LambdaIntegration(setBirthdateFunction),
      commonAuthorizerProps
    );
  }
}

export default UserApi;
