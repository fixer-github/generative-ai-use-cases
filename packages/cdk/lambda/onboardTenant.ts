import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CloudFormationClient, CreateStackCommand, DescribeStacksCommand, Stack } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const cfnClient = new CloudFormationClient({});
const dynamoClient = new DynamoDBClient({});

interface OnboardTenantRequest {
  tenantId: string;
  tenantName?: string;
  adminEmail?: string;
  billingMode?: 'PAY_PER_REQUEST' | 'PROVISIONED';
}

/**
 * Lambda function to onboard a new tenant by creating their DynamoDB tables
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    // Parse request body
    const request: OnboardTenantRequest = JSON.parse(event.body || '{}');
    
    if (!request.tenantId) {
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
    const sanitizedTenantId = request.tenantId.replace(/[^a-zA-Z0-9-]/g, '-');
    const stackName = `TenantDynamoDB-${sanitizedTenantId}`;

    // Check if stack already exists
    try {
      const describeResult = await cfnClient.send(
        new DescribeStacksCommand({
          StackName: stackName,
        })
      );

      const stack = describeResult.Stacks?.[0];
      if (stack && stack.StackStatus !== 'DELETE_COMPLETE') {
        return {
          statusCode: 409,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            message: `Tenant ${request.tenantId} already exists`,
            stackName,
            status: stack.StackStatus,
          }),
        };
      }
    } catch (error: any) {
      // Stack doesn't exist, which is what we want
      if (error.name !== 'ValidationError') {
        throw error;
      }
    }

    // Create CloudFormation template
    const template = {
      AWSTemplateFormatVersion: '2010-09-09',
      Description: `DynamoDB tables for tenant ${request.tenantId}`,
      Resources: {
        ChatHistoryTable: {
          Type: 'AWS::DynamoDB::Table',
          Properties: {
            TableName: `ChatHistory-tenant-${sanitizedTenantId}`,
            AttributeDefinitions: [
              {
                AttributeName: 'id',
                AttributeType: 'S',
              },
              {
                AttributeName: 'createdDate',
                AttributeType: 'S',
              },
              {
                AttributeName: 'feedback',
                AttributeType: 'S',
              },
            ],
            KeySchema: [
              {
                AttributeName: 'id',
                KeyType: 'HASH',
              },
              {
                AttributeName: 'createdDate',
                KeyType: 'RANGE',
              },
            ],
            BillingMode: request.billingMode || 'PAY_PER_REQUEST',
            PointInTimeRecoverySpecification: {
              PointInTimeRecoveryEnabled: true,
            },
            SSESpecification: {
              SSEEnabled: true,
            },
            GlobalSecondaryIndexes: [
              {
                IndexName: 'FeedbackIndex',
                KeySchema: [
                  {
                    AttributeName: 'feedback',
                    KeyType: 'HASH',
                  },
                ],
                Projection: {
                  ProjectionType: 'ALL',
                },
              },
            ],
            Tags: [
              {
                Key: 'TenantId',
                Value: request.tenantId,
              },
              {
                Key: 'Purpose',
                Value: 'TenantChatHistory',
              },
            ],
          },
        },
        TokenUsageStatsTable: {
          Type: 'AWS::DynamoDB::Table',
          Properties: {
            TableName: `TokenUsageStats-tenant-${sanitizedTenantId}`,
            AttributeDefinitions: [
              {
                AttributeName: 'id',
                AttributeType: 'S',
              },
              {
                AttributeName: 'userId',
                AttributeType: 'S',
              },
              {
                AttributeName: 'month',
                AttributeType: 'S',
              },
            ],
            KeySchema: [
              {
                AttributeName: 'id',
                KeyType: 'HASH',
              },
              {
                AttributeName: 'userId',
                KeyType: 'RANGE',
              },
            ],
            BillingMode: request.billingMode || 'PAY_PER_REQUEST',
            PointInTimeRecoverySpecification: {
              PointInTimeRecoveryEnabled: true,
            },
            SSESpecification: {
              SSEEnabled: true,
            },
            GlobalSecondaryIndexes: [
              {
                IndexName: 'MonthIndex',
                KeySchema: [
                  {
                    AttributeName: 'month',
                    KeyType: 'HASH',
                  },
                  {
                    AttributeName: 'userId',
                    KeyType: 'RANGE',
                  },
                ],
                Projection: {
                  ProjectionType: 'ALL',
                },
              },
            ],
            Tags: [
              {
                Key: 'TenantId',
                Value: request.tenantId,
              },
              {
                Key: 'Purpose',
                Value: 'TenantTokenUsageStats',
              },
            ],
          },
        },
      },
      Outputs: {
        ChatHistoryTableName: {
          Description: 'Name of the chat history table',
          Value: { Ref: 'ChatHistoryTable' },
          Export: {
            Name: `${stackName}-ChatHistoryTableName`,
          },
        },
        TokenUsageStatsTableName: {
          Description: 'Name of the token usage stats table',
          Value: { Ref: 'TokenUsageStatsTable' },
          Export: {
            Name: `${stackName}-TokenUsageStatsTableName`,
          },
        },
        ChatHistoryTableArn: {
          Description: 'ARN of the chat history table',
          Value: { 'Fn::GetAtt': ['ChatHistoryTable', 'Arn'] },
          Export: {
            Name: `${stackName}-ChatHistoryTableArn`,
          },
        },
        TokenUsageStatsTableArn: {
          Description: 'ARN of the token usage stats table',
          Value: { 'Fn::GetAtt': ['TokenUsageStatsTable', 'Arn'] },
          Export: {
            Name: `${stackName}-TokenUsageStatsTableArn`,
          },
        },
      },
    };

    // Create the stack
    await cfnClient.send(
      new CreateStackCommand({
        StackName: stackName,
        TemplateBody: JSON.stringify(template),
        Tags: [
          {
            Key: 'TenantId',
            Value: request.tenantId,
          },
          {
            Key: 'TenantName',
            Value: request.tenantName || request.tenantId,
          },
          {
            Key: 'Purpose',
            Value: 'TenantDynamoDBStack',
          },
        ],
        Capabilities: ['CAPABILITY_IAM'],
      })
    );

    // Log tenant metadata if needed
    if (request.adminEmail || request.tenantName) {
      console.log('Tenant onboarded:', {
        tenantId: request.tenantId,
        tenantName: request.tenantName,
        adminEmail: request.adminEmail,
        stackName,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Tenant onboarding initiated successfully',
        tenantId: request.tenantId,
        stackName,
        tables: {
          chatHistory: `ChatHistory-tenant-${sanitizedTenantId}`,
          tokenUsageStats: `TokenUsageStats-tenant-${sanitizedTenantId}`,
        },
      }),
    };
  } catch (error) {
    console.error('Error onboarding tenant:', error);
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