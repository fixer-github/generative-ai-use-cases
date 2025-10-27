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

    const createAssistantFunction = new NodejsFunction(
      this,
      'CreateAssistant',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/createAssistant.ts',
        timeout: Duration.minutes(15),
        environment: getBaseEnvironment(this, props, {
          ASSISTANT_TABLE_NAME: ASSISTANT_TABLE_PREFIX,
          DEFAULT_ASSISTANT_TABLE_NAME: assistantTable.tableName,
        }),
      }
    );
    assistantTable.grantWriteData(createAssistantFunction);

    const listAssistantsFunction = new NodejsFunction(
      this,
      'ListAssistants',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/listAssistants.ts',
        timeout: Duration.minutes(15),
        environment: getBaseEnvironment(this, props, {
          ASSISTANT_TABLE_NAME: ASSISTANT_TABLE_PREFIX,
          DEFAULT_ASSISTANT_TABLE_NAME: assistantTable.tableName,
        }),
      }
    );
    assistantTable.grantReadData(listAssistantsFunction);

    const getAssistantFunction = new NodejsFunction(this, 'GetAssistant', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/getAssistant.ts',
      timeout: Duration.minutes(15),
      environment: getBaseEnvironment(this, props, {
        ASSISTANT_TABLE_NAME: ASSISTANT_TABLE_PREFIX,
        DEFAULT_ASSISTANT_TABLE_NAME: assistantTable.tableName,
      }),
    });
    assistantTable.grantReadData(getAssistantFunction);

    const updateAssistantFunction = new NodejsFunction(
      this,
      'UpdateAssistant',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/updateAssistant.ts',
        timeout: Duration.minutes(15),
        environment: getBaseEnvironment(this, props, {
          ASSISTANT_TABLE_NAME: ASSISTANT_TABLE_PREFIX,
          DEFAULT_ASSISTANT_TABLE_NAME: assistantTable.tableName,
        }),
      }
    );
    assistantTable.grantReadWriteData(updateAssistantFunction);

    const deleteAssistantFunction = new NodejsFunction(
      this,
      'DeleteAssistant',
      {
        runtime: LAMBDA_RUNTIME_NODEJS,
        entry: './lambda/deleteAssistant.ts',
        timeout: Duration.minutes(15),
        environment: getBaseEnvironment(this, props, {
          ASSISTANT_TABLE_NAME: ASSISTANT_TABLE_PREFIX,
          DEFAULT_ASSISTANT_TABLE_NAME: assistantTable.tableName,
          ASSISTANT_MESSAGES_TABLE_NAME: ASSISTANT_MESSAGES_TABLE_PREFIX,
          DEFAULT_ASSISTANT_MESSAGES_TABLE_NAME:
            assistantMessagesTable.tableName,
        }),
      }
    );
    assistantTable.grantReadWriteData(deleteAssistantFunction);
    assistantMessagesTable.grantReadWriteData(deleteAssistantFunction);

    const createMessageFunction = new NodejsFunction(this, 'CreateMessage', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/createAssistantMessage.ts',
      timeout: Duration.minutes(15),
      environment: getBaseEnvironment(this, props, {
        ASSISTANT_TABLE_NAME: ASSISTANT_TABLE_PREFIX,
        DEFAULT_ASSISTANT_TABLE_NAME: assistantTable.tableName,
        ASSISTANT_MESSAGES_TABLE_NAME: ASSISTANT_MESSAGES_TABLE_PREFIX,
        DEFAULT_ASSISTANT_MESSAGES_TABLE_NAME: assistantMessagesTable.tableName,
        MODEL_REGION: props.modelRegion,
      }),
    });
    assistantTable.grantReadData(createMessageFunction);
    assistantMessagesTable.grantReadWriteData(createMessageFunction);

    // Grant Bedrock permissions
    if (props.bedrockPolicy) {
      createMessageFunction.addToRolePolicy(props.bedrockPolicy);
    }

    const listMessagesFunction = new NodejsFunction(this, 'ListMessages', {
      runtime: LAMBDA_RUNTIME_NODEJS,
      entry: './lambda/listAssistantMessages.ts',
      timeout: Duration.minutes(15),
      environment: getBaseEnvironment(this, props, {
        ASSISTANT_MESSAGES_TABLE_NAME: ASSISTANT_MESSAGES_TABLE_PREFIX,
        DEFAULT_ASSISTANT_MESSAGES_TABLE_NAME: assistantMessagesTable.tableName,
      }),
    });
    assistantMessagesTable.grantReadData(listMessagesFunction);

    // POST: /assistant
    assistantResource.addMethod(
      'POST',
      new LambdaIntegration(createAssistantFunction),
      commonAuthorizerProps
    );

    // GET: /assistant
    assistantResource.addMethod(
      'GET',
      new LambdaIntegration(listAssistantsFunction),
      commonAuthorizerProps
    );

    const assistantIdResource = assistantResource.addResource('{assistantId}');

    // GET: /assistant/{assistantId}
    assistantIdResource.addMethod(
      'GET',
      new LambdaIntegration(getAssistantFunction),
      commonAuthorizerProps
    );

    // PUT: /assistant/{assistantId}
    assistantIdResource.addMethod(
      'PUT',
      new LambdaIntegration(updateAssistantFunction),
      commonAuthorizerProps
    );

    // DELETE: /assistant/{assistantId}
    assistantIdResource.addMethod(
      'DELETE',
      new LambdaIntegration(deleteAssistantFunction),
      commonAuthorizerProps
    );

    const messagesResource = assistantIdResource.addResource('messages');

    // POST: /assistant/{assistantId}/messages
    messagesResource.addMethod(
      'POST',
      new LambdaIntegration(createMessageFunction),
      commonAuthorizerProps
    );

    // GET: /assistant/{assistantId}/messages
    messagesResource.addMethod(
      'GET',
      new LambdaIntegration(listMessagesFunction),
      commonAuthorizerProps
    );

    // Grant tenant table read permissions if tenant manager exists
    if (tenantManager) {
      tenantManager.tenantsTable.grantReadData(createAssistantFunction);
      tenantManager.tenantsTable.grantReadData(listAssistantsFunction);
      tenantManager.tenantsTable.grantReadData(getAssistantFunction);
      tenantManager.tenantsTable.grantReadData(updateAssistantFunction);
      tenantManager.tenantsTable.grantReadData(deleteAssistantFunction);
      tenantManager.tenantsTable.grantReadData(createMessageFunction);
      tenantManager.tenantsTable.grantReadData(listMessagesFunction);
    }
  }
}

export default AssistantApi;
