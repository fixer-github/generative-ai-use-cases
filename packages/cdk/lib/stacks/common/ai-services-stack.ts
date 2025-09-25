import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import { IdentityPool } from 'aws-cdk-lib/aws-cognito-identitypool';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import {
  Rag,
  RagKnowledgeBase,
  Transcribe,
  UseCaseBuilder,
} from '../../construct';
import { TenantManager } from '../../construct';
import { ProcessedStackInput } from '../../stack-input';
import { allowS3AccessWithSourceIpCondition } from '../../utils/s3-access-policy';

export interface AIServicesStackProps extends StackProps {
  readonly params: ProcessedStackInput;
  readonly userPool: UserPool;
  readonly idPool: IdentityPool;
  readonly restApi: RestApi;
  readonly tenantManager: TenantManager;
  readonly knowledgeBaseId?: string;
  readonly knowledgeBaseDataSourceBucketName?: string;
  readonly getFileDownloadSignedUrlFunction: IFunction;
}

export class AIServicesStack extends Stack {
  public readonly ragDataSourceBucketName?: string;

  constructor(scope: Construct, id: string, props: AIServicesStackProps) {
    super(scope, id, props);

    const params = props.params;

    if (params.ragEnabled) {
      const rag = new Rag(this, 'Rag', {
        envSuffix: params.env,
        kendraIndexLanguage: params.kendraIndexLanguage,
        kendraIndexArnInCdkContext: params.kendraIndexArn,
        kendraDataSourceBucketName: params.kendraDataSourceBucketName,
        kendraIndexScheduleEnabled: params.kendraIndexScheduleEnabled,
        kendraIndexScheduleCreateCron: params.kendraIndexScheduleCreateCron,
        kendraIndexScheduleDeleteCron: params.kendraIndexScheduleDeleteCron,
        userPool: props.userPool,
        api: props.restApi,
      });

      this.ragDataSourceBucketName = rag.dataSourceBucketName;

      if (
        rag.dataSourceBucketName &&
        props.getFileDownloadSignedUrlFunction.role
      ) {
        allowS3AccessWithSourceIpCondition(
          rag.dataSourceBucketName,
          props.getFileDownloadSignedUrlFunction.role,
          'read',
          {
            ipv4: params.allowedIpV4AddressRanges,
            ipv6: params.allowedIpV6AddressRanges,
          }
        );
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
          userPool: props.userPool,
          api: props.restApi,
        });

        if (
          props.knowledgeBaseDataSourceBucketName &&
          props.getFileDownloadSignedUrlFunction.role
        ) {
          allowS3AccessWithSourceIpCondition(
            props.knowledgeBaseDataSourceBucketName,
            props.getFileDownloadSignedUrlFunction.role,
            'read',
            {
              ipv4: params.allowedIpV4AddressRanges,
              ipv6: params.allowedIpV6AddressRanges,
            }
          );
        }
      }
    }

    if (params.useCaseBuilderEnabled) {
      new UseCaseBuilder(this, 'UseCaseBuilder', {
        userPool: props.userPool,
        api: props.restApi,
        idPool: props.idPool,
        environment: params.env,
        tenantManager: props.tenantManager,
      });
    }

    new Transcribe(this, 'Transcribe', {
      userPool: props.userPool,
      idPool: props.idPool,
      api: props.restApi,
      allowedIpV4AddressRanges: params.allowedIpV4AddressRanges,
      allowedIpV6AddressRanges: params.allowedIpV6AddressRanges,
      tenantManager: props.tenantManager,
      environment: params.env,
    });
  }
}