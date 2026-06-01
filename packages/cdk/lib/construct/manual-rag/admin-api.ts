import { Duration } from 'aws-cdk-lib';
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  ResponseType,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { ManualStorage } from './storage';

export interface ManualAdminApiProps {
  readonly userPool: UserPool;
  readonly userPoolClient: UserPoolClient;
  readonly storage: ManualStorage;
}

/**
 * Manual admin API (B2).
 * REST API + management Lambdas behind a Cognito authorizer. Authorization to the
 * "admin" group is enforced inside each Lambda (the Cognito authorizer itself does
 * not restrict by group). Endpoints:
 *   POST   /manuals                     - issue presigned upload URL + create item
 *   GET    /manuals                     - list manuals
 *   DELETE /manuals/{manualId}          - delete item + S3 objects
 *   PATCH  /manuals/{manualId}          - update title / description
 *   POST   /manuals/{manualId}/reprocess- reprocess (clear artifacts + invoke B4)
 */
export class ManualAdminApi extends Construct {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: ManualAdminApiProps) {
    super(scope, id);

    const { userPool, userPoolClient, storage } = props;
    const { bucket, table } = storage;

    const commonEnv = {
      TABLE_NAME: table.tableName,
      BUCKET_NAME: bucket.bucketName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
    };

    const defineFunction = (name: string, entry: string) =>
      new NodejsFunction(this, name, {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry,
        timeout: Duration.minutes(1),
        environment: commonEnv,
      });

    // POST /manuals
    const createUploadUrlFunction = defineFunction(
      'CreateUploadUrl',
      './lambda/manual/createUploadUrl.ts'
    );
    table.grantWriteData(createUploadUrlFunction);
    bucket.grantPut(createUploadUrlFunction);

    // GET /manuals
    const listManualsFunction = defineFunction(
      'ListManuals',
      './lambda/manual/listManuals.ts'
    );
    table.grantReadData(listManualsFunction);

    // DELETE /manuals/{manualId}
    const deleteManualFunction = defineFunction(
      'DeleteManual',
      './lambda/manual/deleteManual.ts'
    );
    table.grantReadWriteData(deleteManualFunction);
    bucket.grantRead(deleteManualFunction);
    bucket.grantDelete(deleteManualFunction);

    // POST /manuals/{manualId}/reprocess
    // PREPROCESS_FUNCTION_ARN is wired in B4; empty for now (the handler guards).
    const reprocessManualFunction = new NodejsFunction(
      this,
      'ReprocessManual',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/manual/reprocessManual.ts',
        timeout: Duration.minutes(1),
        environment: {
          ...commonEnv,
          PREPROCESS_FUNCTION_ARN: '',
        },
      }
    );
    table.grantReadWriteData(reprocessManualFunction);
    bucket.grantRead(reprocessManualFunction);
    bucket.grantDelete(reprocessManualFunction);

    // PATCH /manuals/{manualId}
    const updateManualFunction = defineFunction(
      'UpdateManual',
      './lambda/manual/updateManual.ts'
    );
    table.grantReadWriteData(updateManualFunction);

    // API Gateway with Cognito authorizer
    const authorizer = new CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
    });
    const commonAuthorizerProps = {
      authorizationType: AuthorizationType.COGNITO,
      authorizer,
    };

    const api = new RestApi(this, 'Api', {
      deployOptions: {
        stageName: 'api',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
      },
      cloudWatchRole: true,
      defaultMethodOptions: commonAuthorizerProps,
    });

    api.addGatewayResponse('Api4XX', {
      type: ResponseType.DEFAULT_4XX,
      responseHeaders: { 'Access-Control-Allow-Origin': "'*'" },
    });
    api.addGatewayResponse('Api5XX', {
      type: ResponseType.DEFAULT_5XX,
      responseHeaders: { 'Access-Control-Allow-Origin': "'*'" },
    });

    const manualsResource = api.root.addResource('manuals');
    manualsResource.addMethod(
      'POST',
      new LambdaIntegration(createUploadUrlFunction),
      commonAuthorizerProps
    );
    manualsResource.addMethod(
      'GET',
      new LambdaIntegration(listManualsFunction),
      commonAuthorizerProps
    );

    const manualResource = manualsResource.addResource('{manualId}');
    manualResource.addMethod(
      'DELETE',
      new LambdaIntegration(deleteManualFunction),
      commonAuthorizerProps
    );
    manualResource.addMethod(
      'PATCH',
      new LambdaIntegration(updateManualFunction),
      commonAuthorizerProps
    );

    const reprocessResource = manualResource.addResource('reprocess');
    reprocessResource.addMethod(
      'POST',
      new LambdaIntegration(reprocessManualFunction),
      commonAuthorizerProps
    );

    this.api = api;
  }
}
