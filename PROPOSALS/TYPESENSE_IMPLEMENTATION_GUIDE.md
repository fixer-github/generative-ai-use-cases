# Typesense実装ガイド

## 目次

- [概要](#概要)
- [CDK構成](#cdk構成)
- [データ同期の実装](#データ同期の実装)
- [検索APIの実装](#検索apiの実装)
- [フロントエンド統合](#フロントエンド統合)
- [テスト戦略](#テスト戦略)
- [デプロイ手順](#デプロイ手順)
- [トラブルシューティング](#トラブルシューティング)

---

## 概要

本ドキュメントは、TypesenseをGenUプロジェクトに統合するための技術的な実装ガイドです。

### 前提条件

- Node.js 18.x以上
- AWS CDK 2.x
- TypeScript 5.x
- Docker（ローカル開発用）

### ディレクトリ構成

```
packages/cdk/
├── lib/
│   ├── construct/
│   │   └── typesense-cluster.ts       # Typesenseクラスター構成
│   └── stacks/
│       └── common/
│           └── typesense-stack.ts     # Typesenseスタック
├── lambda/
│   ├── syncToTypesense.ts             # データ同期Lambda
│   ├── searchConversationsTypesense.ts # 会話検索Lambda
│   └── searchBotsTypesense.ts         # ボット検索Lambda
└── custom-resources/
    └── typesense-index-creator.ts     # インデックス作成カスタムリソース
```

---

## CDK構成

### Typesenseクラスター Construct

**ファイル:** `packages/cdk/lib/construct/typesense-cluster.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface TypesenseClusterProps {
  /**
   * VPC to deploy Typesense cluster
   */
  readonly vpc: ec2.IVpc;

  /**
   * CPU units for Fargate task (256, 512, 1024, 2048, 4096)
   * Default: 512 (0.5 vCPU)
   */
  readonly cpu?: number;

  /**
   * Memory for Fargate task in MiB (512, 1024, 2048, 4096, 8192)
   * Default: 1024 (1 GB)
   */
  readonly memoryLimitMiB?: number;

  /**
   * Number of Fargate tasks to run
   * Default: 2 (for high availability)
   */
  readonly desiredCount?: number;

  /**
   * Environment suffix (e.g., "dev", "prod")
   */
  readonly envSuffix: string;
}

export class TypesenseCluster extends Construct {
  /**
   * The Typesense service
   */
  public readonly service: ecs.FargateService;

  /**
   * The internal load balancer
   */
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  /**
   * The Typesense API key secret
   */
  public readonly apiKeySecret: secretsmanager.ISecret;

  /**
   * The Typesense endpoint URL
   */
  public readonly endpointUrl: string;

  /**
   * Security group for Typesense service
   */
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: TypesenseClusterProps) {
    super(scope, id);

    const cpu = props.cpu ?? 512;
    const memoryLimitMiB = props.memoryLimitMiB ?? 1024;
    const desiredCount = props.desiredCount ?? 2;

    // Create API key secret
    this.apiKeySecret = new secretsmanager.Secret(this, 'ApiKeySecret', {
      secretName: `typesense-api-key${props.envSuffix}`,
      description: 'Typesense API key for authentication',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'apiKey',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // Create EFS for persistent storage
    const fileSystem = new efs.FileSystem(this, 'TypesenseFileSystem', {
      vpc: props.vpc,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const accessPoint = fileSystem.addAccessPoint('TypesenseAccessPoint', {
      path: '/typesense-data',
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '755',
      },
      posixUser: {
        gid: '1000',
        uid: '1000',
      },
    });

    // Create ECS cluster
    const cluster = new ecs.Cluster(this, 'TypesenseCluster', {
      vpc: props.vpc,
      clusterName: `typesense-cluster${props.envSuffix}`,
      enableFargateCapacityProviders: true,
    });

    // Create task definition
    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'TypesenseTaskDefinition',
      {
        cpu,
        memoryLimitMiB,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      }
    );

    // Add EFS volume
    taskDefinition.addVolume({
      name: 'typesense-data',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    // Add container
    const container = taskDefinition.addContainer('typesense', {
      image: ecs.ContainerImage.fromRegistry('typesense/typesense:27.1'),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'typesense',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        TYPESENSE_DATA_DIR: '/data',
        TYPESENSE_ENABLE_CORS: 'true',
        TYPESENSE_LOG_LEVEL: 'INFO',
      },
      secrets: {
        TYPESENSE_API_KEY: ecs.Secret.fromSecretsManager(
          this.apiKeySecret,
          'apiKey'
        ),
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -f http://localhost:8108/health || exit 1',
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    container.addMountPoints({
      sourceVolume: 'typesense-data',
      containerPath: '/data',
      readOnly: false,
    });

    container.addPortMappings({
      containerPort: 8108,
      protocol: ecs.Protocol.TCP,
    });

    // Grant EFS access
    fileSystem.grantRootAccess(taskDefinition.taskRole);

    // Create security group for Typesense service
    this.securityGroup = new ec2.SecurityGroup(this, 'TypesenseSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Typesense service',
      allowAllOutbound: true,
    });

    // Create Fargate service
    this.service = new ecs.FargateService(this, 'TypesenseService', {
      cluster,
      taskDefinition,
      desiredCount,
      assignPublicIp: false,
      securityGroups: [this.securityGroup],
      enableExecuteCommand: true,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE',
          weight: 1,
        },
      ],
      circuitBreaker: {
        rollback: true,
      },
    });

    // Allow connections from EFS
    fileSystem.connections.allowDefaultPortFrom(this.service);

    // Create internal Application Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      'TypesenseLoadBalancer',
      {
        vpc: props.vpc,
        internetFacing: false,
        idleTimeout: cdk.Duration.seconds(60),
      }
    );

    // Create target group
    const targetGroup = new elbv2.ApplicationTargetGroup(
      this,
      'TypesenseTargetGroup',
      {
        vpc: props.vpc,
        port: 8108,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [this.service],
        healthCheck: {
          path: '/health',
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
        deregistrationDelay: cdk.Duration.seconds(10),
      }
    );

    // Create listener
    this.loadBalancer.addListener('TypesenseListener', {
      port: 8108,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [targetGroup],
    });

    // Allow Lambda functions to access Typesense
    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(8108),
      'Allow access from VPC'
    );

    // Store endpoint URL
    this.endpointUrl = `http://${this.loadBalancer.loadBalancerDnsName}:8108`;

    // Outputs
    new cdk.CfnOutput(this, 'TypesenseEndpoint', {
      value: this.endpointUrl,
      description: 'Typesense endpoint URL',
      exportName: `${cdk.Stack.of(this).stackName}-TypesenseEndpoint`,
    });

    new cdk.CfnOutput(this, 'TypesenseApiKeySecretArn', {
      value: this.apiKeySecret.secretArn,
      description: 'Typesense API key secret ARN',
      exportName: `${cdk.Stack.of(this).stackName}-TypesenseApiKeySecretArn`,
    });
  }

  /**
   * Grant read access to Typesense
   */
  public grantRead(grantee: iam.IGrantable): iam.Grant {
    return this.apiKeySecret.grantRead(grantee);
  }

  /**
   * Grant write access to Typesense
   */
  public grantWrite(grantee: iam.IGrantable): iam.Grant {
    return this.apiKeySecret.grantRead(grantee);
  }

  /**
   * Allow connections from a security group
   */
  public allowConnectionsFrom(other: ec2.IConnectable): void {
    this.securityGroup.addIngressRule(
      other.connections.securityGroups[0],
      ec2.Port.tcp(8108),
      'Allow access from Lambda'
    );
  }
}
```

### Typesenseスタック

**ファイル:** `packages/cdk/lib/stacks/common/typesense-stack.ts`

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { TypesenseCluster } from '../../construct/typesense-cluster';

export interface TypesenseStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly envSuffix: string;
}

export class TypesenseStack extends cdk.Stack {
  public readonly typesenseCluster: TypesenseCluster;

  constructor(scope: Construct, id: string, props: TypesenseStackProps) {
    super(scope, id, props);

    this.typesenseCluster = new TypesenseCluster(this, 'TypesenseCluster', {
      vpc: props.vpc,
      envSuffix: props.envSuffix,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 2,
    });

    // Add tags
    cdk.Tags.of(this).add('Environment', props.envSuffix);
    cdk.Tags.of(this).add('Service', 'Typesense');
  }
}
```

---

## データ同期の実装

### DynamoDB Streams Lambda関数

**ファイル:** `packages/cdk/lambda/syncToTypesense.ts`

```typescript
import {
  DynamoDBStreamEvent,
  DynamoDBRecord,
  AttributeValue,
} from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import Typesense from 'typesense';

// Environment variables
const TYPESENSE_HOST = process.env.TYPESENSE_HOST!;
const TYPESENSE_API_KEY_SECRET_ARN = process.env.TYPESENSE_API_KEY_SECRET_ARN!;

let typesenseClient: Typesense.Client | null = null;
let apiKey: string | null = null;

/**
 * Get Typesense API key from Secrets Manager
 */
async function getApiKey(): Promise<string> {
  if (apiKey) {
    return apiKey;
  }

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: TYPESENSE_API_KEY_SECRET_ARN,
    })
  );

  const secret = JSON.parse(response.SecretString!);
  apiKey = secret.apiKey;
  return apiKey;
}

/**
 * Get or create Typesense client
 */
async function getTypesenseClient(): Promise<Typesense.Client> {
  if (typesenseClient) {
    return typesenseClient;
  }

  const key = await getApiKey();
  typesenseClient = new Typesense.Client({
    nodes: [
      {
        host: TYPESENSE_HOST.replace(/^https?:\/\//, '').replace(/:8108$/, ''),
        port: 8108,
        protocol: 'http',
      },
    ],
    apiKey: key,
    connectionTimeoutSeconds: 10,
  });

  return typesenseClient;
}

/**
 * Unmarshal DynamoDB attribute value
 */
function unmarshal(value: AttributeValue): any {
  if (value.S !== undefined) return value.S;
  if (value.N !== undefined) return parseFloat(value.N);
  if (value.BOOL !== undefined) return value.BOOL;
  if (value.NULL !== undefined) return null;
  if (value.L !== undefined) return value.L.map(unmarshal);
  if (value.M !== undefined) {
    const obj: Record<string, any> = {};
    for (const [k, v] of Object.entries(value.M)) {
      obj[k] = unmarshal(v);
    }
    return obj;
  }
  if (value.SS !== undefined) return value.SS;
  if (value.NS !== undefined) return value.NS.map(parseFloat);
  return null;
}

/**
 * Convert DynamoDB item to Typesense document for conversations
 */
function convertToConversationDocument(
  item: Record<string, AttributeValue>
): any {
  const unmarshalled = Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, unmarshal(v)])
  );

  // Extract conversation ID from SK (e.g., "userId#CONV#convId" -> "convId")
  const sk = unmarshalled.SK || '';
  const conversationId = sk.split('#CONV#')[1] || sk;

  // Extract message content
  const messages = unmarshalled.MessageMap || {};
  const messageContent = Object.values(messages)
    .filter((msg: any) => msg?.content?.body)
    .map((msg: any) => msg.content.body);

  // Get last message time
  const messageTimes = Object.values(messages)
    .filter((msg: any) => msg?.create_time)
    .map((msg: any) => msg.create_time);
  const lastMessageTime =
    messageTimes.length > 0 ? Math.max(...messageTimes) : 0;

  return {
    id: conversationId,
    user_id: unmarshalled.PK || '',
    title: unmarshalled.Title || 'Untitled conversation',
    message_content: messageContent,
    last_message_time: Math.floor(lastMessageTime * 1000), // Convert to milliseconds
    create_time: Math.floor((unmarshalled.CreateTime || 0) * 1000),
    bot_id: unmarshalled.BotId || '',
  };
}

/**
 * Convert DynamoDB item to Typesense document for bots
 */
function convertToBotDocument(item: Record<string, AttributeValue>): any {
  const unmarshalled = Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, unmarshal(v)])
  );

  return {
    id: unmarshalled.BotId || '',
    owner_id: unmarshalled.PK || '',
    title: unmarshalled.Title || '',
    description: unmarshalled.Description || '',
    instruction: unmarshalled.Instruction || '',
    usage_count: unmarshalled.UsageStats?.usage_count || 0,
    shared_scope: unmarshalled.SharedScope || 'private',
    allowed_users: unmarshalled.AllowedCognitoUsers || [],
    allowed_groups: unmarshalled.AllowedCognitoGroups || [],
    create_time: Math.floor((unmarshalled.CreateTime || 0) * 1000),
    last_used_time: Math.floor(
      (unmarshalled.LastUsedTime || unmarshalled.CreateTime || 0) * 1000
    ),
  };
}

/**
 * Determine collection name from DynamoDB record
 */
function getCollectionName(record: DynamoDBRecord): string | null {
  const newImage = record.dynamodb?.NewImage;
  const oldImage = record.dynamodb?.OldImage;
  const image = newImage || oldImage;

  if (!image) {
    return null;
  }

  const sk = unmarshal(image.SK);

  // Determine collection based on SK prefix
  if (sk.includes('#CONV#')) {
    return 'conversations';
  } else if (sk.startsWith('BOT#')) {
    return 'bots';
  }

  return null;
}

/**
 * Process a single DynamoDB stream record
 */
async function processRecord(
  client: Typesense.Client,
  record: DynamoDBRecord
): Promise<void> {
  const eventName = record.eventName;
  const collectionName = getCollectionName(record);

  if (!collectionName) {
    console.log('Skipping record: not a conversation or bot');
    return;
  }

  console.log(`Processing ${eventName} for collection ${collectionName}`);

  try {
    if (eventName === 'REMOVE') {
      // Delete document
      const oldImage = record.dynamodb!.OldImage!;
      const sk = unmarshal(oldImage.SK);
      const id =
        collectionName === 'conversations'
          ? sk.split('#CONV#')[1]
          : unmarshal(oldImage.BotId);

      await client.collections(collectionName).documents(id).delete();
      console.log(`Deleted document ${id} from ${collectionName}`);
    } else {
      // Insert or update document
      const newImage = record.dynamodb!.NewImage!;
      const document =
        collectionName === 'conversations'
          ? convertToConversationDocument(newImage)
          : convertToBotDocument(newImage);

      await client.collections(collectionName).documents().upsert(document);
      console.log(`Upserted document ${document.id} to ${collectionName}`);
    }
  } catch (error) {
    console.error(`Error processing record:`, error);
    throw error; // Re-throw to trigger Lambda retry
  }
}

/**
 * Lambda handler
 */
export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  console.log(`Processing ${event.Records.length} records`);

  const client = await getTypesenseClient();

  // Process records in parallel
  const promises = event.Records.map((record) => processRecord(client, record));

  await Promise.allSettled(promises);

  console.log('Processing complete');
};
```

### 初期データ移行スクリプト

**ファイル:** `packages/cdk/lambda/initialDataMigration.ts`

```typescript
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import Typesense from 'typesense';

const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME!;
const TYPESENSE_HOST = process.env.TYPESENSE_HOST!;
const TYPESENSE_API_KEY_SECRET_ARN = process.env.TYPESENSE_API_KEY_SECRET_ARN!;

interface MigrationProgress {
  totalItems: number;
  processedItems: number;
  conversations: number;
  bots: number;
  errors: number;
}

/**
 * Lambda handler for initial data migration
 */
export const handler = async (): Promise<MigrationProgress> => {
  console.log('Starting initial data migration from DynamoDB to Typesense');

  const progress: MigrationProgress = {
    totalItems: 0,
    processedItems: 0,
    conversations: 0,
    bots: 0,
    errors: 0,
  };

  // Get Typesense API key
  const secretsClient = new SecretsManagerClient({});
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: TYPESENSE_API_KEY_SECRET_ARN,
    })
  );
  const secret = JSON.parse(secretResponse.SecretString!);
  const apiKey = secret.apiKey;

  // Initialize Typesense client
  const typesenseClient = new Typesense.Client({
    nodes: [
      {
        host: TYPESENSE_HOST.replace(/^https?:\/\//, '').replace(/:8108$/, ''),
        port: 8108,
        protocol: 'http',
      },
    ],
    apiKey,
    connectionTimeoutSeconds: 30,
  });

  // Initialize DynamoDB client
  const dynamoClient = new DynamoDBClient({});

  // Scan DynamoDB table
  let lastEvaluatedKey: Record<string, any> | undefined;
  const batchSize = 100;

  do {
    const scanResult = await dynamoClient.send(
      new ScanCommand({
        TableName: DYNAMODB_TABLE_NAME,
        Limit: batchSize,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const items = scanResult.Items || [];
    progress.totalItems += items.length;

    // Process items in batches
    const conversationDocs: any[] = [];
    const botDocs: any[] = [];

    for (const item of items) {
      try {
        const sk = item.SK?.S || '';

        if (sk.includes('#CONV#')) {
          // Conversation document
          conversationDocs.push(convertToConversationDocument(item));
          progress.conversations++;
        } else if (sk.startsWith('BOT#')) {
          // Bot document
          botDocs.push(convertToBotDocument(item));
          progress.bots++;
        }

        progress.processedItems++;
      } catch (error) {
        console.error('Error processing item:', error);
        progress.errors++;
      }
    }

    // Bulk import to Typesense
    if (conversationDocs.length > 0) {
      await typesenseClient
        .collections('conversations')
        .documents()
        .import(conversationDocs, { action: 'upsert' });
      console.log(`Imported ${conversationDocs.length} conversations`);
    }

    if (botDocs.length > 0) {
      await typesenseClient
        .collections('bots')
        .documents()
        .import(botDocs, { action: 'upsert' });
      console.log(`Imported ${botDocs.length} bots`);
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  console.log('Migration complete:', progress);
  return progress;
};

// Helper functions (same as syncToTypesense.ts)
function unmarshal(value: any): any {
  // ... (implementation omitted for brevity)
}

function convertToConversationDocument(item: any): any {
  // ... (implementation omitted for brevity)
}

function convertToBotDocument(item: any): any {
  // ... (implementation omitted for brevity)
}
```

---

## 検索APIの実装

### 会話検索API

**ファイル:** `packages/cdk/lambda/searchConversationsTypesense.ts`

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import Typesense from 'typesense';

const TYPESENSE_HOST = process.env.TYPESENSE_HOST!;
const TYPESENSE_API_KEY_SECRET_ARN = process.env.TYPESENSE_API_KEY_SECRET_ARN!;

let typesenseClient: Typesense.Client | null = null;

/**
 * Get Typesense client
 */
async function getTypesenseClient(): Promise<Typesense.Client> {
  if (typesenseClient) {
    return typesenseClient;
  }

  const secretsClient = new SecretsManagerClient({});
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: TYPESENSE_API_KEY_SECRET_ARN,
    })
  );
  const secret = JSON.parse(secretResponse.SecretString!);
  const apiKey = secret.apiKey;

  typesenseClient = new Typesense.Client({
    nodes: [
      {
        host: TYPESENSE_HOST.replace(/^https?:\/\//, '').replace(/:8108$/, ''),
        port: 8108,
        protocol: 'http',
      },
    ],
    apiKey,
    connectionTimeoutSeconds: 10,
  });

  return typesenseClient;
}

/**
 * Extract user ID from Cognito JWT
 */
function getUserId(event: APIGatewayProxyEvent): string {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims || !claims.sub) {
    throw new Error('User ID not found in JWT claims');
  }
  return claims.sub;
}

/**
 * Lambda handler
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const query = body.query || '';
    const limit = body.limit || 20;

    console.log(
      `Searching conversations for user ${userId} with query: ${query}`
    );

    const client = await getTypesenseClient();

    // Build search parameters
    const searchParams = {
      q: query,
      query_by: 'title,message_content',
      filter_by: `user_id:=${userId}`,
      sort_by: '_text_match:desc,last_message_time:desc',
      per_page: limit,
      highlight_fields: 'title,message_content',
      highlight_full_fields: 'message_content',
      highlight_affix_num_tokens: 3,
      snippet_threshold: 30,
      num_typos: 2,
      typo_tokens_threshold: 1,
    };

    // Execute search
    const response = await client
      .collections('conversations')
      .documents()
      .search(searchParams);

    // Format results
    const conversations =
      response.hits?.map((hit: any) => {
        const document = hit.document;
        const highlights: any[] = [];

        // Extract highlights
        if (hit.highlights) {
          for (const highlight of hit.highlights) {
            const fieldName = highlight.field;
            const snippets = highlight.snippets || [];

            highlights.push({
              field_name:
                fieldName === 'message_content' ? 'MessageBody' : fieldName,
              fragments: snippets.map((s: any) => s.snippet),
            });
          }
        }

        return {
          id: document.id,
          title: document.title,
          bot_id: document.bot_id || null,
          last_updated_time: document.last_message_time / 1000, // Convert back to seconds
          highlights: highlights.length > 0 ? highlights : null,
        };
      }) || [];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        conversations,
        total: response.found || 0,
      }),
    };
  } catch (error) {
    console.error('Error searching conversations:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
```

### ボット検索API

**ファイル:** `packages/cdk/lambda/searchBotsTypesense.ts`

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import Typesense from 'typesense';

// ... (Client initialization code same as above)

/**
 * Get user groups from Cognito JWT
 */
function getUserGroups(event: APIGatewayProxyEvent): string[] {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims) {
    return [];
  }

  const groupsString = claims['cognito:groups'];
  if (!groupsString) {
    return [];
  }

  return Array.isArray(groupsString) ? groupsString : [groupsString];
}

/**
 * Build filter expression for bot access control
 */
function buildBotFilter(
  userId: string,
  userGroups: string[],
  scope?: string
): string {
  const filters: string[] = [];

  if (scope) {
    // Apply scope filter
    if (scope === 'private') {
      filters.push(`shared_scope:=private`);
      filters.push(`owner_id:=${userId}`);
    } else if (scope === 'organization') {
      filters.push(`shared_scope:=partial`);
    } else if (scope === 'all') {
      filters.push(`shared_scope:=all`);
    }
  } else {
    // Default access control logic
    const accessFilters: string[] = [];

    // Public bots
    accessFilters.push(`shared_scope:=all`);

    // Owner's private bots
    accessFilters.push(`(owner_id:=${userId} && shared_scope:=private)`);

    // Owner's partial shared bots
    accessFilters.push(`(owner_id:=${userId} && shared_scope:=partial)`);

    // Partial shared bots with user access
    accessFilters.push(`(shared_scope:=partial && allowed_users:=${userId})`);

    // Partial shared bots with group access
    if (userGroups.length > 0) {
      const groupFilters = userGroups.map((g) => `allowed_groups:=${g}`);
      accessFilters.push(
        `(shared_scope:=partial && (${groupFilters.join(' || ')}))`
      );
    }

    filters.push(`(${accessFilters.join(' || ')})`);
  }

  return filters.join(' && ');
}

/**
 * Lambda handler
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = getUserId(event);
    const userGroups = getUserGroups(event);
    const body = JSON.parse(event.body || '{}');
    const query = body.query || '';
    const limit = body.limit || 20;
    const scope = body.scope; // 'private', 'organization', 'all', or undefined
    const sort = body.sort || 'usage'; // 'usage' or 'relevance'

    console.log(
      `Searching bots for user ${userId} with query: ${query}, scope: ${scope}`
    );

    const client = await getTypesenseClient();

    // Build search parameters
    const searchParams: any = {
      q: query || '*',
      query_by: 'title,description,instruction',
      filter_by: buildBotFilter(userId, userGroups, scope),
      per_page: limit,
      num_typos: 2,
      typo_tokens_threshold: 1,
    };

    // Add sorting
    if (sort === 'usage') {
      searchParams.sort_by = 'usage_count:desc';
    } else {
      searchParams.sort_by = '_text_match:desc';
    }

    // Execute search
    const response = await client
      .collections('bots')
      .documents()
      .search(searchParams);

    // Format results
    const bots =
      response.hits?.map((hit: any) => {
        const document = hit.document;

        return {
          id: document.id,
          title: document.title,
          description: document.description,
          owner_user_id: document.owner_id,
          create_time: document.create_time / 1000,
          last_used_time: document.last_used_time / 1000,
          is_pinned: false, // TODO: Implement pinning logic
          is_public: document.shared_scope === 'all',
          shared_scope: document.shared_scope,
          usage_count: document.usage_count,
        };
      }) || [];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        bots,
        total: response.found || 0,
      }),
    };
  } catch (error) {
    console.error('Error searching bots:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};
```

---

## フロントエンド統合

（続きは次のセクションで...）

### 検索APIフック

**ファイル:** `packages/web/src/hooks/useConversationSearchTypesense.ts`

```typescript
import { useMemo } from 'react';
import useSWR from 'swr';
import { fetchAuthSession } from 'aws-amplify/auth';

interface ConversationSearchResult {
  id: string;
  title: string;
  bot_id: string | null;
  last_updated_time: number;
  highlights:
    | {
        field_name: string;
        fragments: string[];
      }[]
    | null;
}

interface UseConversationSearchResult {
  conversations: ConversationSearchResult[];
  total: number;
  isLoading: boolean;
  error: Error | null;
  mutate: () => void;
}

export const useConversationSearch = (
  query: string,
  limit = 20
): UseConversationSearchResult => {
  const apiEndpoint = import.meta.env.VITE_APP_API_ENDPOINT;

  const fetcher = async (): Promise<{
    conversations: ConversationSearchResult[];
    total: number;
  }> => {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(
      `${apiEndpoint}/conversations/search-typesense`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, limit }),
      }
    );

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    return response.json();
  };

  const { data, error, isLoading, mutate } = useSWR(
    query ? ['conversation-search', query, limit] : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  );

  return useMemo(
    () => ({
      conversations: data?.conversations || [],
      total: data?.total || 0,
      isLoading,
      error: error || null,
      mutate,
    }),
    [data, isLoading, error, mutate]
  );
};
```

---

## テスト戦略

### ユニットテスト

**ファイル:** `packages/cdk/lambda/__tests__/syncToTypesense.test.ts`

```typescript
import { handler } from '../syncToTypesense';
import { DynamoDBStreamEvent } from 'aws-lambda';

// Mock dependencies
jest.mock('@aws-sdk/client-secrets-manager');
jest.mock('typesense');

describe('syncToTypesense', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should upsert conversation document on INSERT event', async () => {
    const event: DynamoDBStreamEvent = {
      Records: [
        {
          eventID: '1',
          eventName: 'INSERT',
          eventVersion: '1.1',
          eventSource: 'aws:dynamodb',
          awsRegion: 'us-east-1',
          dynamodb: {
            Keys: {
              PK: { S: 'user123' },
              SK: { S: 'user123#CONV#conv456' },
            },
            NewImage: {
              PK: { S: 'user123' },
              SK: { S: 'user123#CONV#conv456' },
              Title: { S: 'Test Conversation' },
              MessageMap: {
                M: {
                  msg1: {
                    M: {
                      content: {
                        M: {
                          body: { S: 'Hello world' },
                        },
                      },
                      create_time: { N: '1234567890' },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    };

    await handler(event);

    // Verify Typesense upsert was called
    // ... (assertion code)
  });
});
```

### 統合テスト

**ファイル:** `packages/cdk/test/integration/typesense.integration.test.ts`

```typescript
import { TypesenseStack } from '../../lib/stacks/common/typesense-stack';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

describe('Typesense Integration Tests', () => {
  let app: cdk.App;
  let stack: TypesenseStack;

  beforeEach(() => {
    app = new cdk.App();
    const vpc = ec2.Vpc.fromLookup(app, 'VPC', {
      isDefault: true,
    });

    stack = new TypesenseStack(app, 'TestTypesenseStack', {
      vpc,
      envSuffix: 'test',
    });
  });

  it('should create Typesense cluster', () => {
    const template = app.synth().getStackByName(stack.stackName).template;

    // Verify ECS cluster exists
    expect(template.Resources).toHaveProperty('TypesenseCluster');

    // Verify Fargate service exists
    expect(template.Resources).toHaveProperty('TypesenseService');

    // Verify ALB exists
    expect(template.Resources).toHaveProperty('TypesenseLoadBalancer');
  });
});
```

---

## デプロイ手順

### 初回デプロイ

```bash
# 1. インフラをデプロイ
npm run cdk:deploy -- TypesenseStack

# 2. Typesenseスキーマを作成
npm run typesense:create-schema

# 3. 初期データを移行
npm run typesense:migrate

# 4. データ同期Lambda を有効化
npm run cdk:deploy -- SyncLambdaStack

# 5. 検索APIをデプロイ
npm run cdk:deploy -- SearchApiStack
```

### 段階的カットオーバー

```bash
# 1. フィーチャーフラグを有効化（10%のトラフィック）
aws ssm put-parameter \
  --name "/typesense/traffic-percentage" \
  --value "10" \
  --type String \
  --overwrite

# 2. モニタリング（CloudWatch Dashboardで確認）
npm run monitoring:check

# 3. 段階的に増加（50%、100%）
aws ssm put-parameter \
  --name "/typesense/traffic-percentage" \
  --value "100" \
  --type String \
  --overwrite

# 4. OpenSearchを削除
npm run cdk:destroy -- OpenSearchStack
```

---

## トラブルシューティング

### 問題: データ同期が遅延している

**原因:**

- DynamoDB Streams のバッチサイズが小さい
- Lambda関数のタイムアウト

**解決策:**

```typescript
syncFunction.addEventSource(
  new DynamoEventSource(table, {
    startingPosition: StartingPosition.LATEST,
    batchSize: 100, // 10 → 100に増やす
    maxBatchingWindow: Duration.seconds(10), // バッチ待機時間を追加
    retryAttempts: 3,
    parallelizationFactor: 10, // 並列処理を増やす
  })
);
```

### 問題: 検索結果が不正確

**原因:**

- Typo tolerance が高すぎる
- フィールドの重み付けが不適切

**解決策:**

```typescript
const searchParams = {
  q: query,
  query_by: 'title,description,instruction',
  query_by_weights: '3,2,1', // 重み付けを調整
  num_typos: 1, // 2 → 1に減らす
  prefix: true, // プレフィックス検索を有効化
};
```

### 問題: Fargate taskが起動しない

**原因:**

- EFS マウントポイントの権限
- API Key secretが見つからない

**解決策:**

```bash
# ECS Execで直接コンテナに接続
aws ecs execute-command \
  --cluster typesense-cluster \
  --task <task-id> \
  --container typesense \
  --interactive \
  --command "/bin/sh"

# ログを確認
aws logs tail /aws/ecs/typesense --follow
```

---

## 参考資料

- [Typesense Documentation](https://typesense.org/docs/)
- [AWS ECS Fargate Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/intro.html)
- [DynamoDB Streams Lambda Integration](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.Lambda.html)

---

## 変更履歴

| 日付       | バージョン | 変更内容 | 著者   |
| ---------- | ---------- | -------- | ------ |
| 2025-10-31 | 1.0.0      | 初版作成 | Claude |
