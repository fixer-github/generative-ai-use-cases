import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const cfnClient = new CloudFormationClient({});
const dynamoClient = new DynamoDBClient({});

/**
 * Lambda function to get the status of a tenant's resources
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const tenantId = event.pathParameters?.tenantId;
    
    if (!tenantId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Tenant ID is required',
        }),
      };
    }

    // Sanitize tenant ID
    const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9-]/g, '-');
    const stackName = `TenantDynamoDB-${sanitizedTenantId}`;

    try {
      // Get stack status
      const describeResult = await cfnClient.send(
        new DescribeStacksCommand({
          StackName: stackName,
        })
      );

      const stack = describeResult.Stacks?.[0];
      if (!stack) {
        return {
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            message: `Tenant ${tenantId} not found`,
          }),
        };
      }

      // Get table details if stack is complete
      const tables: any = {};
      if (stack.StackStatus === 'CREATE_COMPLETE' || stack.StackStatus === 'UPDATE_COMPLETE') {
        try {
          // Check chat history table
          const chatTableName = `ChatHistory-tenant-${sanitizedTenantId}`;
          const chatTableDesc = await dynamoClient.send(
            new DescribeTableCommand({
              TableName: chatTableName,
            })
          );
          tables.chatHistory = {
            name: chatTableName,
            status: chatTableDesc.Table?.TableStatus,
            itemCount: chatTableDesc.Table?.ItemCount,
            sizeBytes: chatTableDesc.Table?.TableSizeBytes,
            createdAt: chatTableDesc.Table?.CreationDateTime,
          };

          // Check token usage stats table
          const statsTableName = `TokenUsageStats-tenant-${sanitizedTenantId}`;
          const statsTableDesc = await dynamoClient.send(
            new DescribeTableCommand({
              TableName: statsTableName,
            })
          );
          tables.tokenUsageStats = {
            name: statsTableName,
            status: statsTableDesc.Table?.TableStatus,
            itemCount: statsTableDesc.Table?.ItemCount,
            sizeBytes: statsTableDesc.Table?.TableSizeBytes,
            createdAt: statsTableDesc.Table?.CreationDateTime,
          };
        } catch (error) {
          console.error('Error describing tables:', error);
        }
      }

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          tenantId,
          stackName,
          stackStatus: stack.StackStatus,
          stackStatusReason: stack.StackStatusReason,
          createdAt: stack.CreationTime,
          updatedAt: stack.LastUpdatedTime,
          tables,
          outputs: stack.Outputs?.reduce((acc, output) => {
            acc[output.OutputKey!] = output.OutputValue;
            return acc;
          }, {} as Record<string, string>),
        }),
      };
    } catch (error: any) {
      if (error.name === 'ValidationError' && error.message.includes('does not exist')) {
        return {
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            message: `Tenant ${tenantId} not found`,
          }),
        };
      }
      throw error;
    }
  } catch (error) {
    console.error('Error getting tenant status:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};