import { STSClient, AssumeRoleCommand, Credentials } from '@aws-sdk/client-sts';
import {
  BedrockRuntimeClient,
  BedrockRuntimeClientConfig,
} from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockAgentRuntimeClient,
  BedrockAgentRuntimeClientConfig,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
import {
  BedrockAgentClient,
  BedrockAgentClientConfig,
} from '@aws-sdk/client-bedrock-agent';

// Temporary credentials for cross-account access
const stsClient = new STSClient();
let temporaryCredentials: Credentials | undefined;

// Store Bedrock clients
const bedrockRuntimeClient: Record<string, BedrockRuntimeClient> = {};
const bedrockAgentClient: Record<string, BedrockAgentClient> = {};
const bedrockAgentRuntimeClient: Record<string, BedrockAgentRuntimeClient> = {};
const knowledgeBaseS3Client: Record<string, S3Client> = {};

// Function to get temporary credentials from STS
const assumeRole = async (crossAccountBedrockRoleArn: string) => {
  const command = new AssumeRoleCommand({
    RoleArn: crossAccountBedrockRoleArn,
    RoleSessionName: 'BedrockApiAccess',
  });
  try {
    const response = await stsClient.send(command);
    if (response.Credentials) {
      temporaryCredentials = response.Credentials;
    } else {
      throw new Error('Failed to get credentials.');
    }
  } catch (error) {
    console.error('Error assuming role: ', error);
    throw error;
  }
};

// Check if the temporary credentials will expire within 1 minute
const isCredentialRefreshRequired = () => {
  return (
    !temporaryCredentials?.Expiration || // expiration is undefined
    temporaryCredentials.Expiration.getTime() - Date.now() < 60_000 // expiration is less than 1 minute
  );
};

// Get AWS credentials for cross account access.
// Assume the specified role and check if the obtained temporary credentials are valid.
// This allows access to AWS resources in a different AWS account.
const getCrossAccountCredentials = async (
  crossAccountBedrockRoleArn: string
) => {
  // Get temporary credentials from STS and initialize the client
  if (isCredentialRefreshRequired()) {
    await assumeRole(crossAccountBedrockRoleArn);
  }
  if (
    !temporaryCredentials ||
    !temporaryCredentials.AccessKeyId ||
    !temporaryCredentials.SecretAccessKey ||
    !temporaryCredentials.SessionToken
  ) {
    throw new Error('The temporary credentials from STS are incomplete.');
  }
  return {
    credentials: {
      accessKeyId: temporaryCredentials.AccessKeyId,
      secretAccessKey: temporaryCredentials.SecretAccessKey,
      sessionToken: temporaryCredentials.SessionToken,
    },
  };
};

export const initBedrockRuntimeClient = async (
  config: BedrockRuntimeClientConfig & { region: string }
) => {
  // Use cross-account role
  if (process.env.CROSS_ACCOUNT_BEDROCK_ROLE_ARN) {
    const cacheKey = `cross-account-${config.region}`;

    // Check if we need to refresh credentials and recreate client
    if (bedrockRuntimeClient[cacheKey] && !isCredentialRefreshRequired()) {
      console.debug('Reusing cached cross-account Bedrock client:', { region: config.region });
      return bedrockRuntimeClient[cacheKey];
    }

    console.debug('Creating new cross-account Bedrock client:', {
      region: config.region,
      credentialRefreshRequired: isCredentialRefreshRequired(),
    });

    // Refresh credentials and create new client
    bedrockRuntimeClient[cacheKey] = new BedrockRuntimeClient({
      ...(await getCrossAccountCredentials(
        process.env.CROSS_ACCOUNT_BEDROCK_ROLE_ARN
      )),
      ...config,
    });

    return bedrockRuntimeClient[cacheKey];
  }

  // Use Lambda execution role
  if (!(config.region in bedrockRuntimeClient)) {
    console.debug('Creating new Bedrock client with Lambda execution role:', { region: config.region });
    bedrockRuntimeClient[config.region] = new BedrockRuntimeClient(config);
  } else {
    console.debug('Reusing cached Bedrock client:', { region: config.region });
  }
  return bedrockRuntimeClient[config.region];
};

export const initBedrockAgentClient = async (
  config: BedrockAgentClientConfig & { region: string }
) => {
  // Use cross-account role
  if (process.env.CROSS_ACCOUNT_BEDROCK_ROLE_ARN) {
    const cacheKey = `cross-account-${config.region}`;

    // Check if we need to refresh credentials and recreate client
    if (bedrockAgentClient[cacheKey] && !isCredentialRefreshRequired()) {
      return bedrockAgentClient[cacheKey];
    }

    // Refresh credentials and create new client
    bedrockAgentClient[cacheKey] = new BedrockAgentClient({
      ...(await getCrossAccountCredentials(
        process.env.CROSS_ACCOUNT_BEDROCK_ROLE_ARN
      )),
      ...config,
    });

    return bedrockAgentClient[cacheKey];
  }

  // Use Lambda execution role
  if (!(config.region in bedrockAgentClient)) {
    bedrockAgentClient[config.region] = new BedrockAgentClient(config);
  }
  return bedrockAgentClient[config.region];
};

export const initBedrockAgentRuntimeClient = async (
  config: BedrockAgentRuntimeClientConfig & { region: string }
) => {
  // Use cross-account role
  if (process.env.CROSS_ACCOUNT_BEDROCK_ROLE_ARN) {
    const cacheKey = `cross-account-${config.region}`;

    // Check if we need to refresh credentials and recreate client
    if (bedrockAgentRuntimeClient[cacheKey] && !isCredentialRefreshRequired()) {
      return bedrockAgentRuntimeClient[cacheKey];
    }

    // Refresh credentials and create new client
    bedrockAgentRuntimeClient[cacheKey] = new BedrockAgentRuntimeClient({
      ...(await getCrossAccountCredentials(
        process.env.CROSS_ACCOUNT_BEDROCK_ROLE_ARN
      )),
      ...config,
    });

    return bedrockAgentRuntimeClient[cacheKey];
  }

  // Use Lambda execution role
  if (!(config.region in bedrockAgentRuntimeClient)) {
    bedrockAgentRuntimeClient[config.region] = new BedrockAgentRuntimeClient(
      config
    );
  }
  return bedrockAgentRuntimeClient[config.region];
};

export const initKnowledgeBaseS3Client = async (
  config: S3ClientConfig & { region: string }
) => {
  // Use cross-account role (to get pre-signed URLs for S3 objects in a different account)
  if (process.env.CROSS_ACCOUNT_BEDROCK_ROLE_ARN) {
    const cacheKey = `cross-account-${config.region}`;

    // Check if we need to refresh credentials and recreate client
    if (knowledgeBaseS3Client[cacheKey] && !isCredentialRefreshRequired()) {
      return knowledgeBaseS3Client[cacheKey];
    }

    // Refresh credentials and create new client
    knowledgeBaseS3Client[cacheKey] = new S3Client({
      ...(await getCrossAccountCredentials(
        process.env.CROSS_ACCOUNT_BEDROCK_ROLE_ARN
      )),
      ...config,
    });

    return knowledgeBaseS3Client[cacheKey];
  }

  // Use Lambda execution role
  if (!(config.region in knowledgeBaseS3Client)) {
    knowledgeBaseS3Client[config.region] = new S3Client(config);
  }
  return knowledgeBaseS3Client[config.region];
};
