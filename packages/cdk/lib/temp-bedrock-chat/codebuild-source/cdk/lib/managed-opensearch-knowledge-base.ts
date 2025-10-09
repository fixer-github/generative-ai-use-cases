import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { BedrockFoundationModel } from '@cdklabs/generative-ai-cdk-constructs/lib/cdk-lib/bedrock';

export interface ManagedOpenSearchKnowledgeBaseProps {
  readonly domainEndpoint: string;
  readonly domainArn: string;
  readonly indexName: string;
  readonly embeddingsModel: BedrockFoundationModel;
  readonly instruction?: string;
}

/**
 * マネージド版OpenSearchを使用したKnowledge Baseの作成
 */
export class ManagedOpenSearchKnowledgeBase extends Construct {
  public readonly knowledgeBaseId: string;
  public readonly knowledgeBaseArn: string;
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: ManagedOpenSearchKnowledgeBaseProps) {
    super(scope, id);

    // Knowledge Base用のIAMロールを作成
    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      description: 'Role for Bedrock Knowledge Base to access OpenSearch',
    });

    // OpenSearchへのアクセス権限を付与
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'es:ESHttpPost',
          'es:ESHttpPut',
          'es:ESHttpDelete',
          'es:ESHttpGet',
          'es:ESHttpHead',
        ],
        resources: [`${props.domainArn}/*`],
      })
    );

    // Bedrockへのアクセス権限を付与
    this.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [props.embeddingsModel.asArn(this)],
      })
    );

    // まずOpenSearchインデックスを作成
    const createIndex = new AwsCustomResource(this, 'CreateIndex', {
      onCreate: {
        service: 'OpenSearchService',
        action: 'CreateIndex',
        parameters: {
          DomainEndpoint: props.domainEndpoint,
          IndexName: props.indexName,
          Mappings: {
            properties: {
              'bedrock-knowledge-base-default-vector': {
                type: 'knn_vector',
                dimension: props.embeddingsModel.vectorDimensions,
                method: {
                  name: 'hnsw',
                  space_type: 'l2',
                  engine: 'lucene',
                  parameters: {
                    ef_construction: 512,
                    m: 16
                  }
                }
              },
              'AMAZON_BEDROCK_TEXT_CHUNK': {
                type: 'text'
              },
              'AMAZON_BEDROCK_METADATA': {
                type: 'text'
              }
            }
          }
        },
        physicalResourceId: PhysicalResourceId.of(`${props.domainEndpoint}/${props.indexName}`),
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: [
            'es:ESHttpPost',
            'es:ESHttpPut',
            'es:ESHttpGet',
            'es:ESHttpHead',
          ],
          resources: [`${props.domainArn}/*`],
        }),
      ]),
    });

    // Knowledge Baseを作成
    const createKnowledgeBase = new AwsCustomResource(this, 'CreateKnowledgeBase', {
      onCreate: {
        service: 'BedrockAgent',
        action: 'createKnowledgeBase',
        parameters: {
          name: Stack.of(this).stackName,
          roleArn: this.role.roleArn,
          knowledgeBaseConfiguration: {
            type: 'VECTOR',
            vectorKnowledgeBaseConfiguration: {
              embeddingModelArn: props.embeddingsModel.asArn(this),
              embeddingModelConfiguration: {
                bedrockEmbeddingModelConfiguration: {
                  dimensions: props.embeddingsModel.vectorDimensions,
                }
              }
            }
          },
          storageConfiguration: {
            type: 'OPENSEARCH_SERVERLESS',
            opensearchServerlessConfiguration: {
              collectionArn: props.domainArn,
              vectorIndexName: props.indexName,
              fieldMapping: {
                vectorField: 'bedrock-knowledge-base-default-vector',
                textField: 'AMAZON_BEDROCK_TEXT_CHUNK',
                metadataField: 'AMAZON_BEDROCK_METADATA'
              }
            }
          },
          description: props.instruction,
        },
        physicalResourceId: PhysicalResourceId.fromResponse('knowledgeBase.knowledgeBaseId'),
      },
      onDelete: {
        service: 'BedrockAgent',
        action: 'deleteKnowledgeBase',
        parameters: {
          knowledgeBaseId: PhysicalResourceId.fromResponse('knowledgeBase.knowledgeBaseId'),
        },
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: [
            'bedrock:CreateKnowledgeBase',
            'bedrock:DeleteKnowledgeBase',
            'bedrock:UpdateKnowledgeBase',
            'bedrock:GetKnowledgeBase',
          ],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['iam:PassRole'],
          resources: [this.role.roleArn],
        }),
      ]),
    });

    // インデックス作成後にKnowledge Baseを作成
    createKnowledgeBase.node.addDependency(createIndex);
    createKnowledgeBase.node.addDependency(this.role);

    // Knowledge BaseのIDとARNを取得
    this.knowledgeBaseId = createKnowledgeBase.getResponseField('knowledgeBase.knowledgeBaseId');
    this.knowledgeBaseArn = createKnowledgeBase.getResponseField('knowledgeBase.knowledgeBaseArn');
  }
}