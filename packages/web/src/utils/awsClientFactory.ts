import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import { DynamoDBClient, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { BedrockRuntimeClient, BedrockRuntimeClientConfig } from '@aws-sdk/client-bedrock-runtime';

interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

/**
 * Creates an S3 client with temporary STS credentials
 * @param credentials - STS temporary credentials
 * @param region - AWS region
 * @returns Configured S3Client
 */
export const createS3Client = (
  credentials: AWSCredentials,
  region: string = import.meta.env.VITE_APP_REGION
): S3Client => {
  const config: S3ClientConfig = {
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  };

  return new S3Client(config);
};

/**
 * Creates a DynamoDB client with temporary STS credentials
 * @param credentials - STS temporary credentials
 * @param region - AWS region
 * @returns Configured DynamoDBClient
 */
export const createDynamoDBClient = (
  credentials: AWSCredentials,
  region: string = import.meta.env.VITE_APP_REGION
): DynamoDBClient => {
  const config: DynamoDBClientConfig = {
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  };

  return new DynamoDBClient(config);
};

/**
 * Creates a Bedrock Runtime client with temporary STS credentials
 * @param credentials - STS temporary credentials
 * @param region - AWS region
 * @returns Configured BedrockRuntimeClient
 */
export const createBedrockClient = (
  credentials: AWSCredentials,
  region: string = import.meta.env.VITE_APP_MODEL_REGION || import.meta.env.VITE_APP_REGION
): BedrockRuntimeClient => {
  const config: BedrockRuntimeClientConfig = {
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  };

  return new BedrockRuntimeClient(config);
};