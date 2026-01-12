/**
 * Flow Execution Repository
 *
 * Manages CRUD operations for flow execution history in DynamoDB.
 * This repository handles the persistence of flow execution records including
 * creation, updates, and queries using various indexes.
 *
 * Database Per Tenantsパターンに従い、テナント専用のDynamoDBテーブルにアクセスします。
 * テーブル名: {tenantId}-flow-execution-history
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { FlowExecution, FlowExecutionStatus, FlowType } from '../types';
import { createTenantDynamoDBClientForBackgroundJob } from '../../../utils/tenantDynamoDBClient';

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
  private docClient: DynamoDBDocumentClient | null = null;
  private readonly tenantId: string;

  constructor(tenantId: string, client?: DynamoDBClient) {
    this.tenantId = tenantId;
    // クライアントが指定された場合は同期的に使用（テスト用）
    if (client) {
      this.docClient = DynamoDBDocumentClient.from(client, {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      });
    }
  }

  /**
   * DynamoDB Document Clientを取得（遅延初期化）
   * createTenantDynamoDBClientForBackgroundJobを使用してテナント固有のクライアントを作成
   */
  private async getDocClient(): Promise<DynamoDBDocumentClient> {
    if (!this.docClient) {
      const dynamoClient = await createTenantDynamoDBClientForBackgroundJob(this.tenantId);
      this.docClient = DynamoDBDocumentClient.from(dynamoClient, {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      });
    }
    return this.docClient;
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
    const docClient = await this.getDocClient();

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

      await docClient.send(command);
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
    const docClient = await this.getDocClient();

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
        updateExpressions.push('#duration = :duration');
        expressionAttributeNames['#duration'] = 'duration';
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

      await docClient.send(command);
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
    const docClient = await this.getDocClient();

    try {
      const command = new GetCommand({
        TableName: this.getTableName(),
        Key: {
          flowExecutionId,
        },
      });

      const response = await docClient.send(command);

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
    const docClient = await this.getDocClient();

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

      const response = await docClient.send(command);

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
    const docClient = await this.getDocClient();

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

      const response = await docClient.send(command);

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
    const docClient = await this.getDocClient();

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

      const response = await docClient.send(command);

      return (response.Items || []) as FlowExecution[];
    } catch (error) {
      console.error('Failed to list flow executions by tenant and flow type:', error);
      console.error('Flow type:', flowType);
      throw error;
    }
  }

  /**
   * List flow execution records with multiple filters
   *
   * This method supports flexible filtering with multiple conditions.
   * It chooses the most efficient query strategy based on the provided filters:
   * - If only status is provided: Uses status-startedAt-index
   * - If only userId is provided: Uses userId-startedAt-index
   * - If only flowType is provided: Uses tenantId-flowType-index
   * - Otherwise: Uses Scan with FilterExpression
   *
   * @param params - Filter parameters
   * @returns Array of flow execution records and pagination token
   * @throws {Error} If the DynamoDB operation fails
   */
  async listWithFilters(params: {
    status?: FlowExecutionStatus;
    flowType?: FlowType;
    userId?: string;
    fromDate?: number;
    toDate?: number;
    limit?: number;
    lastEvaluatedKey?: Record<string, unknown>;
  }): Promise<{
    items: FlowExecution[];
    lastEvaluatedKey?: Record<string, unknown>;
  }> {
    const docClient = await this.getDocClient();
    const limit = params.limit || 20;

    try {
      // Determine the best query strategy based on provided filters
      const hasStatus = params.status !== undefined;
      const hasUserId = params.userId !== undefined;
      const hasFlowType = params.flowType !== undefined;
      const hasDateRange = params.fromDate !== undefined || params.toDate !== undefined;

      // Build filter expressions for additional conditions
      const buildFilterExpression = (
        excludeField?: 'status' | 'userId' | 'flowType'
      ): {
        filterExpression?: string;
        expressionAttributeNames: Record<string, string>;
        expressionAttributeValues: Record<string, unknown>;
      } => {
        const conditions: string[] = [];
        const names: Record<string, string> = {};
        const values: Record<string, unknown> = {};

        if (hasStatus && excludeField !== 'status') {
          conditions.push('#status = :status');
          names['#status'] = 'status';
          values[':status'] = params.status;
        }

        if (hasUserId && excludeField !== 'userId') {
          conditions.push('userId = :userId');
          values[':userId'] = params.userId;
        }

        if (hasFlowType && excludeField !== 'flowType') {
          conditions.push('flowType = :flowType');
          values[':flowType'] = params.flowType;
        }

        if (params.fromDate !== undefined) {
          conditions.push('startedAt >= :fromDate');
          values[':fromDate'] = params.fromDate;
        }

        if (params.toDate !== undefined) {
          conditions.push('startedAt <= :toDate');
          values[':toDate'] = params.toDate;
        }

        return {
          filterExpression: conditions.length > 0 ? conditions.join(' AND ') : undefined,
          expressionAttributeNames: names,
          expressionAttributeValues: values,
        };
      };

      // Strategy 1: Use status-startedAt-index if status is the primary filter
      if (hasStatus && !hasUserId) {
        const { filterExpression, expressionAttributeNames, expressionAttributeValues } =
          buildFilterExpression('status');

        // Add status to expressionAttributeNames for KeyConditionExpression
        expressionAttributeNames['#status'] = 'status';
        expressionAttributeValues[':status'] = params.status;

        // Build KeyConditionExpression with date range if available
        let keyConditionExpression = '#status = :status';
        if (hasDateRange) {
          if (params.fromDate !== undefined && params.toDate !== undefined) {
            keyConditionExpression += ' AND startedAt BETWEEN :fromDate AND :toDate';
          } else if (params.fromDate !== undefined) {
            keyConditionExpression += ' AND startedAt >= :fromDate';
          } else if (params.toDate !== undefined) {
            keyConditionExpression += ' AND startedAt <= :toDate';
          }
        }

        // Remove date conditions from filter since they're in key condition
        const filteredConditions = filterExpression
          ?.split(' AND ')
          .filter(c => !c.includes('startedAt'))
          .join(' AND ') || undefined;

        const command = new QueryCommand({
          TableName: this.getTableName(),
          IndexName: 'status-startedAt-index',
          KeyConditionExpression: keyConditionExpression,
          FilterExpression: filteredConditions || undefined,
          ExpressionAttributeNames:
            Object.keys(expressionAttributeNames).length > 0
              ? expressionAttributeNames
              : undefined,
          ExpressionAttributeValues: expressionAttributeValues,
          ScanIndexForward: false,
          Limit: limit,
          ExclusiveStartKey: params.lastEvaluatedKey,
        });

        const response = await docClient.send(command);

        return {
          items: (response.Items || []) as FlowExecution[],
          lastEvaluatedKey: response.LastEvaluatedKey,
        };
      }

      // Strategy 2: Use userId-startedAt-index if userId is provided
      if (hasUserId) {
        const { filterExpression, expressionAttributeNames, expressionAttributeValues } =
          buildFilterExpression('userId');

        expressionAttributeValues[':userId'] = params.userId;

        // Build KeyConditionExpression with date range if available
        let keyConditionExpression = 'userId = :userId';
        if (hasDateRange) {
          if (params.fromDate !== undefined && params.toDate !== undefined) {
            keyConditionExpression += ' AND startedAt BETWEEN :fromDate AND :toDate';
          } else if (params.fromDate !== undefined) {
            keyConditionExpression += ' AND startedAt >= :fromDate';
          } else if (params.toDate !== undefined) {
            keyConditionExpression += ' AND startedAt <= :toDate';
          }
        }

        // Remove date conditions from filter since they're in key condition
        const filteredConditions = filterExpression
          ?.split(' AND ')
          .filter(c => !c.includes('startedAt'))
          .join(' AND ') || undefined;

        const command = new QueryCommand({
          TableName: this.getTableName(),
          IndexName: 'userId-startedAt-index',
          KeyConditionExpression: keyConditionExpression,
          FilterExpression: filteredConditions || undefined,
          ExpressionAttributeNames:
            Object.keys(expressionAttributeNames).length > 0
              ? expressionAttributeNames
              : undefined,
          ExpressionAttributeValues: expressionAttributeValues,
          ScanIndexForward: false,
          Limit: limit,
          ExclusiveStartKey: params.lastEvaluatedKey,
        });

        const response = await docClient.send(command);

        return {
          items: (response.Items || []) as FlowExecution[],
          lastEvaluatedKey: response.LastEvaluatedKey,
        };
      }

      // Strategy 3: Use tenantId-flowType-index if flowType is provided
      if (hasFlowType) {
        const { filterExpression, expressionAttributeNames, expressionAttributeValues } =
          buildFilterExpression('flowType');

        expressionAttributeValues[':tenantId'] = this.tenantId;
        expressionAttributeValues[':flowType'] = params.flowType;

        const command = new QueryCommand({
          TableName: this.getTableName(),
          IndexName: 'tenantId-flowType-index',
          KeyConditionExpression: 'tenantId = :tenantId AND flowType = :flowType',
          FilterExpression: filterExpression || undefined,
          ExpressionAttributeNames:
            Object.keys(expressionAttributeNames).length > 0
              ? expressionAttributeNames
              : undefined,
          ExpressionAttributeValues: expressionAttributeValues,
          ScanIndexForward: false,
          Limit: limit,
          ExclusiveStartKey: params.lastEvaluatedKey,
        });

        const response = await docClient.send(command);

        return {
          items: (response.Items || []) as FlowExecution[],
          lastEvaluatedKey: response.LastEvaluatedKey,
        };
      }

      // Strategy 4: Fall back to Scan when no efficient index can be used
      const { filterExpression, expressionAttributeNames, expressionAttributeValues } =
        buildFilterExpression();

      const command = new ScanCommand({
        TableName: this.getTableName(),
        FilterExpression: filterExpression || undefined,
        ExpressionAttributeNames:
          Object.keys(expressionAttributeNames).length > 0
            ? expressionAttributeNames
            : undefined,
        ExpressionAttributeValues:
          Object.keys(expressionAttributeValues).length > 0
            ? expressionAttributeValues
            : undefined,
        Limit: limit,
        ExclusiveStartKey: params.lastEvaluatedKey,
      });

      const response = await docClient.send(command);

      // Sort by startedAt DESC (Scan doesn't guarantee order)
      const items = (response.Items || []) as FlowExecution[];
      items.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

      return {
        items,
        lastEvaluatedKey: response.LastEvaluatedKey,
      };
    } catch (error) {
      console.error('Failed to list flow executions with filters:', error);
      console.error('Params:', params);
      throw error;
    }
  }
}
