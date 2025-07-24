import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AssumeRoleWithWebIdentityCommand, STSClient } from '@aws-sdk/client-sts';

export interface TenantDataAccessConfig {
  roleArn: string;
  tableName: string;
  bucketName: string;
}

export class TenantDataAccess {
  private stsClient: STSClient;
  private config: TenantDataAccessConfig;

  constructor(config: TenantDataAccessConfig) {
    this.config = config;
    this.stsClient = new STSClient({});
  }

  /**
   * Assume the tenant role using the provided web identity token
   */
  async assumeTenantRole(webIdentityToken: string, tenantId: string) {
    const command = new AssumeRoleWithWebIdentityCommand({
      RoleArn: this.config.roleArn,
      RoleSessionName: `tenant-session-${tenantId}`,
      WebIdentityToken: webIdentityToken,
      DurationSeconds: 3600, // 1 hour
    });

    const response = await this.stsClient.send(command);
    return response.Credentials;
  }

  /**
   * Create clients with tenant-specific credentials
   */
  createTenantClients(credentials: any) {
    const config = {
      credentials: {
        accessKeyId: credentials.AccessKeyId!,
        secretAccessKey: credentials.SecretAccessKey!,
        sessionToken: credentials.SessionToken!,
      },
    };

    const dynamoClient = new DynamoDBClient(config);
    const docClient = DynamoDBDocumentClient.from(dynamoClient);
    const s3Client = new S3Client(config);

    return { docClient, s3Client };
  }

  /**
   * Query tenant-specific data from DynamoDB
   */
  async queryTenantData(
    docClient: DynamoDBDocumentClient,
    tenantId: string,
    dataType?: string
  ) {
    const params: any = {
      TableName: this.config.tableName,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
      },
    };

    if (dataType) {
      params.IndexName = 'dataTypeIndex';
      params.KeyConditionExpression += ' AND dataType = :dataType';
      params.ExpressionAttributeValues[':dataType'] = dataType;
    }

    const command = new QueryCommand(params);
    const response = await docClient.send(command);
    return response.Items;
  }

  /**
   * Store tenant data in DynamoDB
   */
  async storeTenantData(
    docClient: DynamoDBDocumentClient,
    tenantId: string,
    dataId: string,
    data: any
  ) {
    const command = new PutCommand({
      TableName: this.config.tableName,
      Item: {
        tenantId,
        dataId,
        ...data,
        timestamp: new Date().toISOString(),
      },
    });

    await docClient.send(command);
  }

  /**
   * Upload file to tenant-specific S3 path
   */
  async uploadTenantFile(
    s3Client: S3Client,
    tenantId: string,
    fileName: string,
    fileContent: Buffer | Uint8Array | string
  ) {
    const command = new PutObjectCommand({
      Bucket: this.config.bucketName,
      Key: `tenants/${tenantId}/${fileName}`,
      Body: fileContent,
      ServerSideEncryption: 'AES256',
    });

    await s3Client.send(command);
  }

  /**
   * Download file from tenant-specific S3 path
   */
  async downloadTenantFile(
    s3Client: S3Client,
    tenantId: string,
    fileName: string
  ) {
    const command = new GetObjectCommand({
      Bucket: this.config.bucketName,
      Key: `tenants/${tenantId}/${fileName}`,
    });

    const response = await s3Client.send(command);
    return response.Body;
  }
}

/**
 * Example Lambda handler using the tenant data access
 */
export const handler = async (event: any) => {
  // Extract tenant information from the event
  const tenantId = event.requestContext?.authorizer?.claims?.['custom:tenant_id'];
  const webIdentityToken = event.headers?.Authorization?.replace('Bearer ', '');

  if (!tenantId || !webIdentityToken) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const config: TenantDataAccessConfig = {
    roleArn: process.env.TENANT_ROLE_ARN!,
    tableName: process.env.TENANT_TABLE_NAME!,
    bucketName: process.env.TENANT_BUCKET_NAME!,
  };

  const tenantAccess = new TenantDataAccess(config);

  try {
    // Assume the tenant role
    const credentials = await tenantAccess.assumeTenantRole(webIdentityToken, tenantId);
    const { docClient, s3Client } = tenantAccess.createTenantClients(credentials);

    // Perform operations based on the request
    const { action, ...params } = JSON.parse(event.body || '{}');

    switch (action) {
      case 'query':
        const data = await tenantAccess.queryTenantData(
          docClient,
          tenantId,
          params.dataType
        );
        return {
          statusCode: 200,
          body: JSON.stringify({ data }),
        };

      case 'store':
        await tenantAccess.storeTenantData(
          docClient,
          tenantId,
          params.dataId,
          params.data
        );
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true }),
        };

      case 'uploadFile':
        await tenantAccess.uploadTenantFile(
          s3Client,
          tenantId,
          params.fileName,
          Buffer.from(params.fileContent, 'base64')
        );
        return {
          statusCode: 200,
          body: JSON.stringify({ success: true }),
        };

      case 'downloadFile':
        const fileStream = await tenantAccess.downloadTenantFile(
          s3Client,
          tenantId,
          params.fileName
        );
        // Convert stream to base64 for API response
        const chunks: any[] = [];
        for await (const chunk of fileStream as any) {
          chunks.push(chunk);
        }
        const fileContent = Buffer.concat(chunks).toString('base64');
        return {
          statusCode: 200,
          body: JSON.stringify({ fileContent }),
        };

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid action' }),
        };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};