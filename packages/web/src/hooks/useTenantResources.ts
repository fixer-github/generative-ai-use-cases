import { useState, useCallback } from 'react';
import { ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { QueryCommand, AttributeValue } from '@aws-sdk/client-dynamodb';
import { useSTSCredentials } from './useSTSCredentials';
import {
  createS3Client,
  createDynamoDBClient,
} from '../utils/awsClientFactory';

export const useTenantResources = () => {
  const {
    credentials,
    isLoading: credentialsLoading,
    error: credentialsError,
  } = useSTSCredentials();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * List objects in a tenant-specific S3 bucket
   * @param bucketPrefix - The bucket prefix (e.g., 'uploads', 'documents')
   * @param tenantId - The tenant ID
   * @returns List of objects in the bucket
   */
  const listS3Objects = useCallback(
    async (bucketPrefix: string, tenantId: string) => {
      if (!credentials) {
        throw new Error('No credentials available');
      }

      setIsLoading(true);
      setError(null);

      try {
        const s3Client = createS3Client(credentials);
        const bucketName = `${bucketPrefix}-tenant-${tenantId}`;

        const command = new ListObjectsV2Command({
          Bucket: bucketName,
        });

        const response = await s3Client.send(command);
        return response.Contents || [];
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to list objects';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [credentials]
  );

  /**
   * Upload a file to a tenant-specific S3 bucket
   * @param bucketPrefix - The bucket prefix
   * @param tenantId - The tenant ID
   * @param key - The object key
   * @param body - The file content
   * @returns Upload result
   */
  const uploadToS3 = useCallback(
    async (
      bucketPrefix: string,
      tenantId: string,
      key: string,
      body: Blob | string
    ) => {
      if (!credentials) {
        throw new Error('No credentials available');
      }

      setIsLoading(true);
      setError(null);

      try {
        const s3Client = createS3Client(credentials);
        const bucketName = `${bucketPrefix}-tenant-${tenantId}`;

        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
        });

        const response = await s3Client.send(command);
        return response;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to upload file';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [credentials]
  );

  /**
   * Query a tenant-specific DynamoDB table
   * @param tablePrefix - The table prefix (e.g., 'users', 'orders')
   * @param tenantId - The tenant ID
   * @param keyConditionExpression - The key condition expression
   * @param expressionAttributeValues - The expression attribute values
   * @returns Query results
   */
  const queryDynamoDB = useCallback(
    async (
      tablePrefix: string,
      tenantId: string,
      keyConditionExpression: string,
      expressionAttributeValues: Record<string, AttributeValue>
    ) => {
      if (!credentials) {
        throw new Error('No credentials available');
      }

      setIsLoading(true);
      setError(null);

      try {
        const dynamoClient = createDynamoDBClient(credentials);
        const tableName = `${tablePrefix}-tenant-${tenantId}`;

        const command = new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: keyConditionExpression,
          ExpressionAttributeValues: expressionAttributeValues,
        });

        const response = await dynamoClient.send(command);
        return response.Items || [];
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to query table';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [credentials]
  );

  return {
    credentials,
    isLoading: isLoading || credentialsLoading,
    error: error || credentialsError,
    listS3Objects,
    uploadToS3,
    queryDynamoDB,
  };
};

