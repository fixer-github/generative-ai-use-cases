import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} from '@aws-sdk/client-sts';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const stsClient = new STSClient({});

async function getDynamoDBClientForTenant(token: string): Promise<DynamoDBClient> {
  const sessionName = `dynamodb-session-${Date.now()}`.substring(0, 64);
  
  const assumeRoleCommand = new AssumeRoleWithWebIdentityCommand({
    RoleArn: process.env.MULTI_TENANT_ROLE_ARN!,
    RoleSessionName: sessionName,
    WebIdentityToken: token,
    DurationSeconds: 3600,
  });

  const stsResponse = await stsClient.send(assumeRoleCommand);
  
  if (!stsResponse.Credentials) {
    throw new Error('Failed to obtain credentials from STS');
  }

  return new DynamoDBClient({
    credentials: {
      accessKeyId: stsResponse.Credentials.AccessKeyId!,
      secretAccessKey: stsResponse.Credentials.SecretAccessKey!,
      sessionToken: stsResponse.Credentials.SessionToken!,
    },
  });
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const token = event.headers['Authorization'];
    if (!token) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Authorization token required',
        }),
      };
    }

    const dynamoClient = await getDynamoDBClientForTenant(token);
    const operation = event.pathParameters?.operation;
    const tablePrefix = process.env.TABLE_PREFIX || 'chats';
    
    // Extract tenant ID from the token claims
    const tenantId = event.requestContext.authorizer?.claims?.['custom:tenantId'] || 'default';
    const tableName = `${tablePrefix}-tenant-${tenantId}`;

    switch (operation) {
      case 'query': {
        const { keyConditionExpression, expressionAttributeValues, expressionAttributeNames } = JSON.parse(event.body || '{}');
        
        const command = new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: keyConditionExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ExpressionAttributeNames: expressionAttributeNames,
        });
        
        const response = await dynamoClient.send(command);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            items: response.Items?.map(item => unmarshall(item)) || [],
            count: response.Count,
          }),
        };
      }

      case 'scan': {
        const { filterExpression, expressionAttributeValues, expressionAttributeNames } = JSON.parse(event.body || '{}');
        
        const command = new ScanCommand({
          TableName: tableName,
          FilterExpression: filterExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ExpressionAttributeNames: expressionAttributeNames,
        });
        
        const response = await dynamoClient.send(command);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            items: response.Items?.map(item => unmarshall(item)) || [],
            count: response.Count,
          }),
        };
      }

      case 'get': {
        const { key } = JSON.parse(event.body || '{}');
        if (!key) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Key is required' }),
          };
        }

        const command = new GetItemCommand({
          TableName: tableName,
          Key: marshall(key),
        });
        
        const response = await dynamoClient.send(command);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            item: response.Item ? unmarshall(response.Item) : null,
          }),
        };
      }

      case 'put': {
        const { item } = JSON.parse(event.body || '{}');
        if (!item) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Item is required' }),
          };
        }

        const command = new PutItemCommand({
          TableName: tableName,
          Item: marshall(item),
        });
        
        await dynamoClient.send(command);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Item saved successfully' }),
        };
      }

      case 'update': {
        const { key, updateExpression, expressionAttributeValues, expressionAttributeNames } = JSON.parse(event.body || '{}');
        if (!key || !updateExpression) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Key and updateExpression are required' }),
          };
        }

        const command = new UpdateItemCommand({
          TableName: tableName,
          Key: marshall(key),
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: expressionAttributeValues ? marshall(expressionAttributeValues) : undefined,
          ExpressionAttributeNames: expressionAttributeNames,
        });
        
        await dynamoClient.send(command);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Item updated successfully' }),
        };
      }

      case 'delete': {
        const { key } = JSON.parse(event.body || '{}');
        if (!key) {
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Key is required' }),
          };
        }

        const command = new DeleteItemCommand({
          TableName: tableName,
          Key: marshall(key),
        });
        
        await dynamoClient.send(command);
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Item deleted successfully' }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ message: 'Invalid operation' }),
        };
    }
  } catch (error) {
    console.error('Error in DynamoDB operation:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'DynamoDB operation failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};