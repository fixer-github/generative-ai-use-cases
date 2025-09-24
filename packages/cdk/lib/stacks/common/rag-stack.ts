import { Stack, StackProps, CfnOutput, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Rag, RagKnowledgeBase } from '../../construct';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { ProcessedStackInput } from '../../stack-input';
import { allowS3AccessWithSourceIpCondition } from '../../utils/s3-access-policy';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export interface RagStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPoolId: string;
  readonly apiRestApiId: string;
  readonly apiRestApiRootResourceId: string;
  readonly getFileDownloadSignedUrlFunctionArn?: string;
  readonly knowledgeBaseId?: string;
  readonly knowledgeBaseDataSourceBucketName?: string;
}

export class RagStack extends Stack {
  public readonly dataSourceBucketName?: string;

  constructor(scope: Construct, id: string, props: RagStackProps) {
    super(scope, id, props);

    const params = props.params;

    const userPool = cognito.UserPool.fromUserPoolId(
      this,
      'ImportedUserPool',
      props.userPoolId
    );

    const restApi = apigateway.RestApi.fromRestApiId(
      this,
      'ImportedRestApi',
      props.apiRestApiId
    );

    if (params.ragEnabled) {
      const rag = new Rag(this, 'Rag', {
        envSuffix: params.env,
        kendraIndexLanguage: params.kendraIndexLanguage,
        kendraIndexArnInCdkContext: params.kendraIndexArn,
        kendraDataSourceBucketName: params.kendraDataSourceBucketName,
        kendraIndexScheduleEnabled: params.kendraIndexScheduleEnabled,
        kendraIndexScheduleCreateCron: params.kendraIndexScheduleCreateCron,
        kendraIndexScheduleDeleteCron: params.kendraIndexScheduleDeleteCron,
        userPool: userPool as cognito.UserPool,
        api: restApi as apigateway.RestApi,
      });

      this.dataSourceBucketName = rag.dataSourceBucketName;

      if (
        rag.dataSourceBucketName &&
        props.getFileDownloadSignedUrlFunctionArn
      ) {
        const getFileDownloadSignedUrlFunction = lambda.Function.fromFunctionArn(
          this,
          'ImportedGetFileDownloadSignedUrlFunction',
          props.getFileDownloadSignedUrlFunctionArn
        );

        if (getFileDownloadSignedUrlFunction.role) {
          allowS3AccessWithSourceIpCondition(
            rag.dataSourceBucketName,
            getFileDownloadSignedUrlFunction.role,
            'read',
            {
              ipv4: params.allowedIpV4AddressRanges,
              ipv6: params.allowedIpV6AddressRanges,
            }
          );
        }
      }

      if (rag.dataSourceBucketName) {
        new CfnOutput(this, 'KendraDataSourceBucketName', {
          value: rag.dataSourceBucketName,
          exportName: `${this.stackName}-KendraDataSourceBucketName`,
        });
      }
    }

    if (params.ragKnowledgeBaseEnabled) {
      const knowledgeBaseId =
        params.ragKnowledgeBaseId || props.knowledgeBaseId;
      if (knowledgeBaseId) {
        new RagKnowledgeBase(this, 'RagKnowledgeBase', {
          modelRegion: params.modelRegion,
          crossAccountBedrockRoleArn: params.crossAccountBedrockRoleArn,
          knowledgeBaseId: knowledgeBaseId,
          userPool: userPool as cognito.UserPool,
          api: restApi as apigateway.RestApi,
        });

        if (
          props.knowledgeBaseDataSourceBucketName &&
          props.getFileDownloadSignedUrlFunctionArn
        ) {
          const getFileDownloadSignedUrlFunction = lambda.Function.fromFunctionArn(
            this,
            'ImportedGetFileDownloadSignedUrlFunctionKB',
            props.getFileDownloadSignedUrlFunctionArn
          );

          if (getFileDownloadSignedUrlFunction.role) {
            allowS3AccessWithSourceIpCondition(
              props.knowledgeBaseDataSourceBucketName,
              getFileDownloadSignedUrlFunction.role,
              'read',
              {
                ipv4: params.allowedIpV4AddressRanges,
                ipv6: params.allowedIpV6AddressRanges,
              }
            );
          }
        }
      }
    }

    new CfnOutput(this, 'RagEnabled', {
      value: params.ragEnabled.toString(),
      exportName: `${this.stackName}-RagEnabled`,
    });

    new CfnOutput(this, 'RagKnowledgeBaseEnabled', {
      value: params.ragKnowledgeBaseEnabled.toString(),
      exportName: `${this.stackName}-RagKnowledgeBaseEnabled`,
    });
  }
}