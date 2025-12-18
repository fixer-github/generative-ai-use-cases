import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration } from 'aws-cdk-lib';
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

    // Lambda function for updating birthdate
    // テーブル名を環境変数から構築（auth.tsと同じ命名規則）
    const userRegistrationMetadataTableName = props.userRegistrationMetadataTable
      ? props.userRegistrationMetadataTable.tableName
      : props.environment
        ? `UserRegistrationMetadata-${props.environment}`
        : 'UserRegistrationMetadata';

    const updateBirthdateFunction = new NodejsFunction(
      this,
      'UpdateBirthdate',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/updateBirthdate.ts',
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
      props.userRegistrationMetadataTable.grantWriteData(updateBirthdateFunction);
    } else {
      // テーブル参照がない場合は、テーブル名ベースで権限を付与
      updateBirthdateFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'dynamodb:UpdateItem',
            'dynamodb:PutItem',
          ],
          resources: [
            `arn:aws:dynamodb:*:*:table/${userRegistrationMetadataTableName}`,
          ],
        })
      );
    }

    // POST /user/birthdate - Update birthdate
    const birthdateResource = userResource.addResource('birthdate');
    birthdateResource.addMethod(
      'POST',
      new LambdaIntegration(updateBirthdateFunction),
      commonAuthorizerProps
    );
  }
}

export default UserApi;
