/**
 * Flow Execution Repository
 *
 * Manages CRUD operations for flow execution history in DynamoDB.
 * This repository handles the persistence of flow execution records including
 * creation, updates, and queries using various indexes.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { FlowExecution, FlowExecutionStatus } from '../types';

/**
 * FlowExecutionRepository
 *
 * Provides data access methods for flow execution history stored in DynamoDB.
 * Table name format: {tenantId}-flow-execution-history
 *
 * GSIs:
 * - userId-startedAt-index: Query by userId
 * - status-startedAt-index: Query by status
 * - tenantId-flowType-index: Query by tenantId and flowType
 */
export class FlowExecutionRepository {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tenantId: string;

  constructor(tenantId: string, client?: DynamoDBClient) {
    const dynamoClient = client || new DynamoDBClient({});
    this.docClient = DynamoDBDocumentClient.from(dynamoClient);
    this.tenantId = tenantId;
  }

  /**
   * Get the DynamoDB table name for flow execution history
   */
  private getTableName(): string {
    return `${this.tenantId}-flow-execution-history`;
  }

  /**
   * Create a new flow execution history record
   *
   * @param flowExecution - The flow execution record to create
   * @throws {Error} If the DynamoDB operation fails
   */
  async create(flowExecution: FlowExecution): Promise<void> {
    try {
      // Set TTL to 1 year from now (Unix timestamp in seconds)
      const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

      const item = {
        ...flowExecution,
        ttl,
      };

      const command = new PutCommand({
        TableName: this.getTableName(),
        Item: item,
      });

      await this.docClient.send(command);
      console.log(
        `Created flow execution: ${flowExecution.flowExecutionId} for tenant: ${this.tenantId}`
      );
    } catch (error) {
      console.error('Failed to create flow execution record:', error);
      console.error('Flow execution data:', flowExecution);
      throw error;
    }
  }

  /**
   * Update an existing flow execution history record
   *
   * @param flowExecutionId - The ID of the flow execution to update
   * @param updates - The fields to update
   * @throws {Error} If the DynamoDB operation fails
   */
  async update(
    flowExecutionId: string,
    updates: {
      status?: FlowExecutionStatus;
      completedAt?: number;
      outputResult?: Record<string, unknown>;
      errorDetails?: {
        errorCode?: string;
        errorMessage: string;
        stackTrace?: string;
      };
      currentStep?: string;
      completedSteps?: number;
      duration?: number;
    }
  ): Promise<void> {
    try {
      // Build update expression dynamically
      const updateExpressions: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, unknown> = {};

      if (updates.status !== undefined) {
        updateExpressions.push('#status = :status');
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeValues[':status'] = updates.status;
      }

      if (updates.completedAt !== undefined) {
        updateExpressions.push('completedAt = :completedAt');
        expressionAttributeValues[':completedAt'] = updates.completedAt;
      }

      if (updates.outputResult !== undefined) {
        updateExpressions.push('outputResult = :outputResult');
        expressionAttributeValues[':outputResult'] = updates.outputResult;
      }

      if (updates.errorDetails !== undefined) {
        updateExpressions.push('errorDetails = :errorDetails');
        expressionAttributeValues[':errorDetails'] = updates.errorDetails;
      }

      if (updates.currentStep !== undefined) {
        updateExpressions.push('currentStep = :currentStep');
        expressionAttributeValues[':currentStep'] = updates.currentStep;
      }

      if (updates.completedSteps !== undefined) {
        updateExpressions.push('completedSteps = :completedSteps');
        expressionAttributeValues[':completedSteps'] = updates.completedSteps;
      }

      if (updates.duration !== undefined) {
        updateExpressions.push('duration = :duration');
        expressionAttributeValues[':duration'] = updates.duration;
      }

      // No updates provided
      if (updateExpressions.length === 0) {
        return;
      }

      const command = new UpdateCommand({
        TableName: this.getTableName(),
        Key: {
          flowExecutionId,
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames:
          Object.keys(expressionAttributeNames).length > 0
            ? expressionAttributeNames
            : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
      });

      await this.docClient.send(command);
      console.log(
        `Updated flow execution: ${flowExecutionId} for tenant: ${this.tenantId}`
      );
    } catch (error) {
      console.error('Failed to update flow execution record:', error);
      console.error('Flow execution ID:', flowExecutionId);
      console.error('Updates:', updates);
      throw error;
    }
  }

  /**
   * Get a flow execution record by ID
   *
   * @param flowExecutionId - The ID of the flow execution to retrieve
   * @returns The flow execution record, or null if not found
   * @throws {Error} If the DynamoDB operation fails
   */
  async getById(flowExecutionId: string): Promise<FlowExecution | null> {
    try {
      const command = new GetCommand({
        TableName: this.getTableName(),
        Key: {
          flowExecutionId,
        },
      });

      const response = await this.docClient.send(command);

      if (!response.Item) {
        return null;
      }

      return response.Item as FlowExecution;
    } catch (error) {
      console.error('Failed to get flow execution record:', error);
      console.error('Flow execution ID:', flowExecutionId);
      throw error;
    }
  }

  /**
   * List flow execution records by user ID
   *
   * Uses GSI: userId-startedAt-index
   * Results are sorted by startedAt in descending order
   *
   * @param userId - The user ID to filter by
   * @param limit - Maximum number of records to return (default: 20)
   * @param lastEvaluatedKey - Pagination token from previous query
   * @returns Array of flow execution records and pagination token
   * @throws {Error} If the DynamoDB operation fails
   */
  async listByUser(
    userId: string,
    limit: number = 20,
    lastEvaluatedKey?: Record<string, unknown>
  ): Promise<{
    items: FlowExecution[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    try {
      const command = new QueryCommand({
        TableName: this.getTableName(),
        IndexName: 'userId-startedAt-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ScanIndexForward: false, // Sort by startedAt DESC
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await this.docClient.send(command);

      return {
        items: (response.Items || []) as FlowExecution[],
        lastEvaluatedKey: response.LastEvaluatedKey,
      };
    } catch (error) {
      console.error('Failed to list flow executions by user:', error);
      console.error('User ID:', userId);
      throw error;
    }
  }

  /**
   * List flow execution records by status
   *
   * Uses GSI: status-startedAt-index
   * Results are sorted by startedAt in descending order
   *
   * @param status - The status to filter by
   * @param limit - Maximum number of records to return (default: 20)
   * @param lastEvaluatedKey - Pagination token from previous query
   * @returns Array of flow execution records and pagination token
   * @throws {Error} If the DynamoDB operation fails
   */
  async listByStatus(
    status: FlowExecutionStatus,
    limit: number = 20,
    lastEvaluatedKey?: Record<string, unknown>
  ): Promise<{
    items: FlowExecution[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    try {
      const command = new QueryCommand({
        TableName: this.getTableName(),
        IndexName: 'status-startedAt-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
        },
        ScanIndexForward: false, // Sort by startedAt DESC
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await this.docClient.send(command);

      return {
        items: (response.Items || []) as FlowExecution[],
        lastEvaluatedKey: response.LastEvaluatedKey,
      };
    } catch (error) {
      console.error('Failed to list flow executions by status:', error);
      console.error('Status:', status);
      throw error;
    }
  }

  /**
   * List flow execution records by tenant ID and flow type
   *
   * Uses GSI: tenantId-flowType-index
   * Results are sorted by startedAt in descending order
   *
   * @param flowType - The flow type to filter by
   * @param limit - Maximum number of records to return (default: 20)
   * @returns Array of flow execution records
   * @throws {Error} If the DynamoDB operation fails
   */
  async listByTenantAndFlowType(
    flowType: string,
    limit: number = 20
  ): Promise<FlowExecution[]> {
    try {
      const command = new QueryCommand({
        TableName: this.getTableName(),
        IndexName: 'tenantId-flowType-index',
        KeyConditionExpression: 'tenantId = :tenantId AND flowType = :flowType',
        ExpressionAttributeValues: {
          ':tenantId': this.tenantId,
          ':flowType': flowType,
        },
        ScanIndexForward: false, // Sort by startedAt DESC
        Limit: limit,
      });

      const response = await this.docClient.send(command);

      return (response.Items || []) as FlowExecution[];
    } catch (error) {
      console.error('Failed to list flow executions by tenant and flow type:', error);
      console.error('Flow type:', flowType);
      throw error;
    }
  }
}
