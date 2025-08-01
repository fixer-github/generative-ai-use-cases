import { useState, useCallback } from 'react';
import axios from 'axios';

interface S3Object {
  key: string;
  size: number;
  lastModified: string;
}

interface DynamoDBItem {
  [key: string]: any;
}

export const useTenantResources = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiEndpoint = import.meta.env.VITE_APP_API_ENDPOINT || '';

  /**
   * Get authorization headers for API requests
   */
  const getAuthHeaders = () => {
    const token = localStorage.getItem('idToken');
    if (!token) {
      throw new Error('No authentication token available');
    }
    return {
      Authorization: token,
      'Content-Type': 'application/json',
    };
  };

  /**
   * List objects in tenant's S3 space
   * @returns List of objects
   */
  const listS3Objects = useCallback(async (): Promise<S3Object[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await axios.get(
        `${apiEndpoint}/tenant/s3/list`,
        { headers: getAuthHeaders() }
      );
      return response.data.objects || [];
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to list objects';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [apiEndpoint]);

  /**
   * Get a presigned URL for uploading a file
   * @param key - The object key
   * @param contentType - The content type of the file
   * @returns Upload URL
   */
  const getUploadUrl = useCallback(
    async (key: string, contentType?: string): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await axios.post(
          `${apiEndpoint}/tenant/s3/upload-url`,
          { key, contentType },
          { headers: getAuthHeaders() }
        );
        return response.data.uploadUrl;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to get upload URL';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiEndpoint]
  );

  /**
   * Upload a file using presigned URL
   * @param key - The object key
   * @param file - The file to upload
   * @returns Upload result
   */
  const uploadToS3 = useCallback(
    async (key: string, file: File | Blob) => {
      setIsLoading(true);
      setError(null);

      try {
        // First get the presigned URL
        const uploadUrl = await getUploadUrl(key, file.type);
        
        // Then upload the file directly to S3
        await axios.put(uploadUrl, file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
        });
        
        return { success: true };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to upload file';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [getUploadUrl]
  );

  /**
   * Get a presigned URL for downloading a file
   * @param key - The object key
   * @returns Download URL
   */
  const getDownloadUrl = useCallback(
    async (key: string): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await axios.post(
          `${apiEndpoint}/tenant/s3/download-url`,
          { key },
          { headers: getAuthHeaders() }
        );
        return response.data.downloadUrl;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to get download URL';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiEndpoint]
  );

  /**
   * Delete an object from S3
   * @param key - The object key
   * @returns Delete result
   */
  const deleteFromS3 = useCallback(
    async (key: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await axios.post(
          `${apiEndpoint}/tenant/s3/delete`,
          { key },
          { headers: getAuthHeaders() }
        );
        return response.data;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to delete object';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiEndpoint]
  );

  /**
   * Query DynamoDB table
   * @param keyConditionExpression - The key condition expression
   * @param expressionAttributeValues - The expression attribute values
   * @param expressionAttributeNames - The expression attribute names
   * @returns Query results
   */
  const queryDynamoDB = useCallback(
    async (
      keyConditionExpression?: string,
      expressionAttributeValues?: Record<string, any>,
      expressionAttributeNames?: Record<string, string>
    ): Promise<DynamoDBItem[]> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await axios.post(
          `${apiEndpoint}/tenant/dynamodb/query`,
          {
            keyConditionExpression,
            expressionAttributeValues,
            expressionAttributeNames,
          },
          { headers: getAuthHeaders() }
        );
        return response.data.items || [];
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to query table';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiEndpoint]
  );

  /**
   * Scan DynamoDB table
   * @param filterExpression - The filter expression
   * @param expressionAttributeValues - The expression attribute values
   * @param expressionAttributeNames - The expression attribute names
   * @returns Scan results
   */
  const scanDynamoDB = useCallback(
    async (
      filterExpression?: string,
      expressionAttributeValues?: Record<string, any>,
      expressionAttributeNames?: Record<string, string>
    ): Promise<DynamoDBItem[]> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await axios.post(
          `${apiEndpoint}/tenant/dynamodb/scan`,
          {
            filterExpression,
            expressionAttributeValues,
            expressionAttributeNames,
          },
          { headers: getAuthHeaders() }
        );
        return response.data.items || [];
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to scan table';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiEndpoint]
  );

  /**
   * Get an item from DynamoDB
   * @param key - The item key
   * @returns The item
   */
  const getItemFromDynamoDB = useCallback(
    async (key: Record<string, any>): Promise<DynamoDBItem | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await axios.post(
          `${apiEndpoint}/tenant/dynamodb/get`,
          { key },
          { headers: getAuthHeaders() }
        );
        return response.data.item;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to get item';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiEndpoint]
  );

  /**
   * Put an item to DynamoDB
   * @param item - The item to put
   * @returns Put result
   */
  const putItemToDynamoDB = useCallback(
    async (item: Record<string, any>) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await axios.post(
          `${apiEndpoint}/tenant/dynamodb/put`,
          { item },
          { headers: getAuthHeaders() }
        );
        return response.data;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to put item';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiEndpoint]
  );

  /**
   * Update an item in DynamoDB
   * @param key - The item key
   * @param updateExpression - The update expression
   * @param expressionAttributeValues - The expression attribute values
   * @param expressionAttributeNames - The expression attribute names
   * @returns Update result
   */
  const updateItemInDynamoDB = useCallback(
    async (
      key: Record<string, any>,
      updateExpression: string,
      expressionAttributeValues?: Record<string, any>,
      expressionAttributeNames?: Record<string, string>
    ) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await axios.post(
          `${apiEndpoint}/tenant/dynamodb/update`,
          {
            key,
            updateExpression,
            expressionAttributeValues,
            expressionAttributeNames,
          },
          { headers: getAuthHeaders() }
        );
        return response.data;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to update item';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiEndpoint]
  );

  /**
   * Delete an item from DynamoDB
   * @param key - The item key
   * @returns Delete result
   */
  const deleteItemFromDynamoDB = useCallback(
    async (key: Record<string, any>) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await axios.post(
          `${apiEndpoint}/tenant/dynamodb/delete`,
          { key },
          { headers: getAuthHeaders() }
        );
        return response.data;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to delete item';
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [apiEndpoint]
  );

  return {
    isLoading,
    error,
    // S3 operations
    listS3Objects,
    uploadToS3,
    getDownloadUrl,
    deleteFromS3,
    // DynamoDB operations
    queryDynamoDB,
    scanDynamoDB,
    getItemFromDynamoDB,
    putItemToDynamoDB,
    updateItemInDynamoDB,
    deleteItemFromDynamoDB,
  };
};