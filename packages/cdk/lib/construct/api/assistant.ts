import { LambdaIntegration } from 'aws-cdk-lib/aws-apigateway';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_RUNTIME_NODEJS } from '../../../consts';
import { Duration } from 'aws-cdk-lib';
import { getBaseEnvironment } from './util';
import {
  ASSISTANT_TABLE_PREFIX,
  ASSISTANT_MESSAGES_TABLE_PREFIX,
} from './const';
import { GenericApiProps } from './props';

export type AssistantApiProps = GenericApiProps;

/**
 * Assistant API construct with consolidated Lambda handlers
 * - assistantHandler: Routes all CRUD operations (POST/, GET/, GET/{id}, PUT/{id}, DELETE/{id})
 * - assistantMessageHandler: Routes message operations (POST/{id}/messages, GET/{id}/messages)
 */
class AssistantApi extends Construct {
  constructor(scope: Construct, id: string, props: AssistantApiProps) {
    super(scope, id);

    const {
      api,
      commonAuthorizerProps,
      assistantTable,
      assistantMessagesTable,
      tenantManager,
    } = props;

    const assistantResource = api.root.addResource('assistant');

    // Consolidated handler for all assistant CRUD operations
    const assistantHandler = new NodejsFunction(this, 'AssistantHandler', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/assistantHandler.ts',
      timeout: Duration.minutes(15),
      environment: getBaseEnvironment(this, props, {
        ASSISTANT_TABLE_NAME: ASSISTANT_TABLE_PREFIX,
        DEFAULT_ASSISTANT_TABLE_NAME: assistantTable.tableName,
        ASSISTANT_MESSAGES_TABLE_NAME: ASSISTANT_MESSAGES_TABLE_PREFIX,
        DEFAULT_ASSISTANT_MESSAGES_TABLE_NAME:
          assistantMessagesTable.tableName,
        OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT || '',
        OPENSEARCH_INDEX: 'assistant-docs',
      }),
    });

    // Grant permissions for all CRUD operations
    assistantTable.grantReadWriteData(assistantHandler);
    assistantMessagesTable.grantReadWriteData(assistantHandler);

    // Grant S3 read permissions for document loading (create/update operations)
    if (props.fileBucket) {
      props.fileBucket.grantRead(assistantHandler);
    }

    // Consolidated handler for all message operations
    const assistantMessageHandler = new NodejsFunction(
      this,
      'AssistantMessageHandler',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/assistantMessageHandler.ts',
        timeout: Duration.minutes(15),
        environment: getBaseEnvironment(this, props, {
          ASSISTANT_TABLE_NAME: ASSISTANT_TABLE_PREFIX,
          DEFAULT_ASSISTANT_TABLE_NAME: assistantTable.tableName,
          ASSISTANT_MESSAGES_TABLE_NAME: ASSISTANT_MESSAGES_TABLE_PREFIX,
          DEFAULT_ASSISTANT_MESSAGES_TABLE_NAME:
            assistantMessagesTable.tableName,
          MODEL_REGION: props.modelRegion,
          OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT || '',
          OPENSEARCH_INDEX: 'assistant-docs',
        }),
      }
    );

    // Grant permissions for message operations
    assistantTable.grantReadData(assistantMessageHandler);
    assistantMessagesTable.grantReadWriteData(assistantMessageHandler);

    // Grant Bedrock permissions for LLM calls
    if (props.bedrockPolicy) {
      assistantMessageHandler.addToRolePolicy(props.bedrockPolicy);
    }

    // API Gateway routes - All route to consolidated handlers
    // POST: /assistant → assistantHandler (create)
    assistantResource.addMethod(
      'POST',
      new LambdaIntegration(assistantHandler),
      commonAuthorizerProps
    );

    // GET: /assistant → assistantHandler (list)
    assistantResource.addMethod(
      'GET',
      new LambdaIntegration(assistantHandler),
      commonAuthorizerProps
    );

    const assistantIdResource = assistantResource.addResource('{assistantId}');

    // GET: /assistant/{assistantId} → assistantHandler (get)
    assistantIdResource.addMethod(
      'GET',
      new LambdaIntegration(assistantHandler),
      commonAuthorizerProps
    );

    // PUT: /assistant/{assistantId} → assistantHandler (update)
    assistantIdResource.addMethod(
      'PUT',
      new LambdaIntegration(assistantHandler),
      commonAuthorizerProps
    );

    // DELETE: /assistant/{assistantId} → assistantHandler (delete)
    assistantIdResource.addMethod(
      'DELETE',
      new LambdaIntegration(assistantHandler),
      commonAuthorizerProps
    );

    const messagesResource = assistantIdResource.addResource('messages');

    // POST: /assistant/{assistantId}/messages → assistantMessageHandler (create message)
    messagesResource.addMethod(
      'POST',
      new LambdaIntegration(assistantMessageHandler),
      commonAuthorizerProps
    );

    // GET: /assistant/{assistantId}/messages → assistantMessageHandler (list messages)
    messagesResource.addMethod(
      'GET',
      new LambdaIntegration(assistantMessageHandler),
      commonAuthorizerProps
    );

    // Grant tenant table read permissions if tenant manager exists
    if (tenantManager) {
      tenantManager.tenantsTable.grantReadData(assistantHandler);
      tenantManager.tenantsTable.grantReadData(assistantMessageHandler);
    }

    // TODO: Add OpenSearch permissions when BotStore is integrated
    // When a BotStore instance is available, add data access policies:
    // botstore.addDataAccessPolicy(
    //   props.envPrefix,
    //   'AssistantDataAccess',
    //   assistantHandler.role!,
    //   ['aoss:DescribeCollectionItems', 'aoss:CreateCollectionItems'],
    //   ['aoss:WriteDocument', 'aoss:DescribeIndex', 'aoss:CreateIndex']
    // );
    // Similarly for assistantMessageHandler
  }
}

export default AssistantApi;
