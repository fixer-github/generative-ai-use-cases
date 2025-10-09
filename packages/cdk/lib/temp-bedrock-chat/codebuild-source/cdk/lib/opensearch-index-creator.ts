import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Stack } from 'aws-cdk-lib';

export interface OpenSearchIndexCreatorProps {
  readonly domainEndpoint: string;
  readonly domainArn: string;
  readonly indexName: string;
  readonly vectorDimensions: number;
}

/**
 * マネージド版OpenSearchドメインにインデックスを作成するためのカスタムリソース
 */
export class OpenSearchIndexCreator extends Construct {
  public readonly indexName: string;

  constructor(scope: Construct, id: string, props: OpenSearchIndexCreatorProps) {
    super(scope, id);

    this.indexName = props.indexName;

    // カスタムリソース用のLambda関数を作成
    const onEventHandler = new lambda.Function(this, 'Handler', {
      runtime: lambda.Runtime.PYTHON_3_13,
      handler: 'index.on_event',
      code: lambda.Code.fromInline(`
import json
import boto3
import urllib3
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

def on_event(event, context):
    print(json.dumps(event))
    request_type = event['RequestType']

    domain_endpoint = event['ResourceProperties']['DomainEndpoint']
    index_name = event['ResourceProperties']['IndexName']
    vector_dimensions = int(event['ResourceProperties']['VectorDimensions'])

    # AWS認証の設定
    credentials = boto3.Session().get_credentials()
    region = event['ResourceProperties']['Region']
    awsauth = AWS4Auth(credentials.access_key, credentials.secret_key,
                       region, 'es', session_token=credentials.token)

    # OpenSearchクライアントの作成
    client = OpenSearch(
        hosts=[{'host': domain_endpoint.replace('https://', ''), 'port': 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        pool_maxsize=20
    )

    if request_type == 'Create' or request_type == 'Update':
        # インデックスの作成または更新
        try:
            # Bedrock Knowledge Base用のマッピング設定
            index_body = {
                "settings": {
                    "index": {
                        "knn": True,
                        "knn.algo_param.ef_search": 512
                    }
                },
                "mappings": {
                    "properties": {
                        "bedrock-knowledge-base-default-vector": {
                            "type": "knn_vector",
                            "dimension": vector_dimensions,
                            "method": {
                                "name": "hnsw",
                                "space_type": "l2",
                                "engine": "lucene",
                                "parameters": {
                                    "ef_construction": 512,
                                    "m": 16
                                }
                            }
                        },
                        "AMAZON_BEDROCK_TEXT_CHUNK": {
                            "type": "text"
                        },
                        "AMAZON_BEDROCK_METADATA": {
                            "type": "text"
                        }
                    }
                }
            }

            # インデックスが存在しない場合のみ作成
            if not client.indices.exists(index=index_name):
                response = client.indices.create(index=index_name, body=index_body)
                print(f"Index {index_name} created: {response}")
            else:
                print(f"Index {index_name} already exists")

        except Exception as e:
            print(f"Error creating index: {e}")
            raise

    elif request_type == 'Delete':
        # インデックスの削除
        try:
            if client.indices.exists(index=index_name):
                response = client.indices.delete(index=index_name)
                print(f"Index {index_name} deleted: {response}")
            else:
                print(f"Index {index_name} does not exist")
        except Exception as e:
            print(f"Error deleting index: {e}")
            # 削除エラーは無視（スタック削除を続行）

    return {
        'PhysicalResourceId': f"{domain_endpoint}/{index_name}",
        'Data': {
            'IndexName': index_name
        }
    }
      `),
      environment: {
        PYTHONPATH: '/var/runtime'
      },
    });

    // Lambda関数にOpenSearchへのアクセス権限を付与
    onEventHandler.addToRolePolicy(
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

    // カスタムリソースプロバイダーを作成
    const provider = new cr.Provider(this, 'Provider', {
      onEventHandler,
    });

    // カスタムリソースを作成
    new cdk.CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      properties: {
        DomainEndpoint: props.domainEndpoint,
        IndexName: props.indexName,
        VectorDimensions: props.vectorDimensions,
        Region: Stack.of(this).region,
      },
    });
  }
}