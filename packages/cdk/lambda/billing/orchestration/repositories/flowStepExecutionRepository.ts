/**
 * Flow Step Execution Repository
 *
 * Manages CRUD operations for flow step execution history in DynamoDB.
 * This repository handles the persistence of step execution records including
 * creation, updates, and queries for individual flow executions.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { StepExecution, StepStatus } from '../types';
import { createTenantDynamoDBClientForBackgroundJob } from '../../../utils/tenantDynamoDBClient';

/**
 * FlowStepExecutionRepository
 *
 * Provides data access methods for step execution history stored in DynamoDB.
 * Table name format: {tenantId}-flow-step-execution-history
 *
 * Primary Key: flowExecutionId (PK), stepSequence (SK)
 */
export class FlowStepExecutionRepository {
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
   * Get the DynamoDB table name for step execution history
   */
  private getTableName(): string {
    return `${this.tenantId}-flow-step-execution-history`;
  }

  /**
   * Create a new step execution history record
   *
   * @param stepExecution - The step execution record to create
   * @throws {Error} If the DynamoDB operation fails
   */
  async create(stepExecution: StepExecution): Promise<void> {
    const docClient = await this.getDocClient();

    try {
      // Set TTL to 1 year from now (Unix timestamp in seconds)
      const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

      const item = {
        ...stepExecution,
        ttl,
      };

      const command = new PutCommand({
        TableName: this.getTableName(),
        Item: item,
      });

      await docClient.send(command);
      console.log(
        `Created step execution: ${stepExecution.flowExecutionId}/${stepExecution.stepSequence} for tenant: ${this.tenantId}`
      );
    } catch (error) {
      console.error('Failed to create step execution record:', error);
      console.error('Step execution data:', stepExecution);
      throw error;
    }
  }

  /**
   * Update an existing step execution history record
   *
   * @param flowExecutionId - The ID of the flow execution
   * @param stepSequence - The sequence number of the step
   * @param updates - The fields to update
   * @throws {Error} If the DynamoDB operation fails
   */
  async update(
    flowExecutionId: string,
    stepSequence: number,
    updates: {
      status?: StepStatus;
      completedAt?: number;
      outputData?: Record<string, unknown>;
      errorDetails?: {
        errorCode?: string;
        errorMessage: string;
        stackTrace?: string;
      };
      retryCount?: number;
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

      if (updates.outputData !== undefined) {
        updateExpressions.push('outputData = :outputData');
        expressionAttributeValues[':outputData'] = updates.outputData;
      }

      if (updates.errorDetails !== undefined) {
        updateExpressions.push('errorDetails = :errorDetails');
        expressionAttributeValues[':errorDetails'] = updates.errorDetails;
      }

      if (updates.retryCount !== undefined) {
        updateExpressions.push('retryCount = :retryCount');
        expressionAttributeValues[':retryCount'] = updates.retryCount;
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
          stepSequence,
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
        `Updated step execution: ${flowExecutionId}/${stepSequence} for tenant: ${this.tenantId}`
      );
    } catch (error) {
      console.error('Failed to update step execution record:', error);
      console.error('Flow execution ID:', flowExecutionId);
      console.error('Step sequence:', stepSequence);
      console.error('Updates:', updates);
      throw error;
    }
  }

  /**
   * List all step execution records for a flow execution
   *
   * Results are sorted by stepSequence in ascending order
   *
   * @param flowExecutionId - The ID of the flow execution
   * @returns Array of step execution records
   * @throws {Error} If the DynamoDB operation fails
   */
  async listByFlowExecution(flowExecutionId: string): Promise<StepExecution[]> {
    const docClient = await this.getDocClient();

    try {
      const command = new QueryCommand({
        TableName: this.getTableName(),
        KeyConditionExpression: 'flowExecutionId = :flowExecutionId',
        ExpressionAttributeValues: {
          ':flowExecutionId': flowExecutionId,
        },
        ScanIndexForward: true, // Sort by stepSequence ASC
      });

      const response = await docClient.send(command);

      return (response.Items || []) as StepExecution[];
    } catch (error) {
      console.error('Failed to list step executions by flow execution:', error);
      console.error('Flow execution ID:', flowExecutionId);
      throw error;
    }
  }
}
