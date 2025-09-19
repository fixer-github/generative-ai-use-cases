import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Environment variables
const PPTX_TEMPLATES_TABLE = process.env.PPTX_TEMPLATES_TABLE!;
const PPTX_GENERATIONS_TABLE = process.env.PPTX_GENERATIONS_TABLE!;

export interface PptxTemplate {
  templateId: string;
  tenantId: string;
  userId: string;
  templateName: string;
  templateDescription?: string;
  s3Key: string;
  thumbnailS3Key?: string;
  isPublic: string; // 'true' or 'false' for GSI compatibility
  tags: string[];
  createdAt: string;
  updatedAt: string;
  ttl?: number;
}

export interface PptxGeneration {
  generationId: string;
  userId: string;
  tenantId: string;
  chatId?: string;
  templateId?: string;
  instructions: string;
  slideCount?: number;
  includeTitleSlide: boolean;
  includeSummarySlide: boolean;
  status: 'generating' | 'completed' | 'failed';
  s3OutputKey?: string;
  errorMessage?: string;
  slides?: any[];
  createdAt: string;
  updatedAt: string;
  ttl?: number;
}

// Template Operations
export async function createTemplate(
  templateId: string,
  tenantId: string,
  userId: string,
  templateName: string,
  templateDescription: string | undefined,
  s3Key: string,
  isPublic: boolean = false,
  tags: string[] = [],
  thumbnailS3Key?: string
): Promise<PptxTemplate> {
  const now = new Date().toISOString();
  const ttl = Math.floor((new Date().getTime() + 365 * 24 * 60 * 60 * 1000) / 1000); // 1 year TTL

  const item: PptxTemplate = {
    templateId,
    tenantId,
    userId,
    templateName,
    templateDescription,
    s3Key,
    thumbnailS3Key,
    isPublic: isPublic ? 'true' : 'false',
    tags,
    createdAt: now,
    updatedAt: now,
    ttl,
  };

  const command = new PutCommand({
    TableName: PPTX_TEMPLATES_TABLE,
    Item: item,
  });

  await docClient.send(command);
  console.log(`Created PPTX template: ${templateId}`);
  return item;
}

export async function findTemplateById(templateId: string): Promise<PptxTemplate | null> {
  const command = new QueryCommand({
    TableName: PPTX_TEMPLATES_TABLE,
    KeyConditionExpression: 'templateId = :templateId',
    ExpressionAttributeValues: {
      ':templateId': templateId,
    },
  });

  const response = await docClient.send(command);
  const items = response.Items;

  if (!items || items.length === 0) {
    return null;
  }

  return items[0] as PptxTemplate;
}

export async function findTemplatesByTenant(
  tenantId: string,
  userId?: string,
  includePublic: boolean = true,
  limit: number = 20,
  offset: number = 0
): Promise<PptxTemplate[]> {
  const templates: PptxTemplate[] = [];

  // Query user's private templates if userId provided
  if (userId) {
    const userCommand = new QueryCommand({
      TableName: PPTX_TEMPLATES_TABLE,
      IndexName: 'TenantUserIndex',
      KeyConditionExpression: 'tenantId = :tenantId AND userId = :userId',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
        ':userId': userId,
      },
      Limit: limit,
    });

    const userResponse = await docClient.send(userCommand);
    if (userResponse.Items) {
      templates.push(...(userResponse.Items as PptxTemplate[]));
    }
  }

  // Query public templates if requested
  if (includePublic && templates.length < limit) {
    const publicCommand = new QueryCommand({
      TableName: PPTX_TEMPLATES_TABLE,
      IndexName: 'TenantPublicIndex',
      KeyConditionExpression: 'tenantId = :tenantId AND isPublic = :isPublic',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
        ':isPublic': 'true',
      },
      Limit: limit - templates.length,
    });

    const publicResponse = await docClient.send(publicCommand);
    if (publicResponse.Items) {
      templates.push(...(publicResponse.Items as PptxTemplate[]));
    }
  }

  // Apply offset and sort by creation date
  return templates
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(offset, offset + limit);
}

export async function deleteTemplateById(templateId: string): Promise<void> {
  // First, get the template to get the tenantId (needed for composite key)
  const template = await findTemplateById(templateId);
  if (!template) {
    throw new Error('Template not found');
  }

  const command = new DeleteCommand({
    TableName: PPTX_TEMPLATES_TABLE,
    Key: {
      templateId,
      tenantId: template.tenantId,
    },
  });

  await docClient.send(command);
  console.log(`Deleted PPTX template: ${templateId}`);
}

// Generation Operations
export async function createGeneration(
  generationId: string,
  userId: string,
  tenantId: string,
  chatId: string | undefined,
  templateId: string | undefined,
  instructions: string,
  slideCount?: number,
  includeTitleSlide: boolean = true,
  includeSummarySlide: boolean = false
): Promise<PptxGeneration> {
  const now = new Date().toISOString();
  const ttl = Math.floor((new Date().getTime() + 7 * 24 * 60 * 60 * 1000) / 1000); // 7 days TTL

  const item: PptxGeneration = {
    generationId,
    userId,
    tenantId,
    chatId,
    templateId,
    instructions,
    slideCount,
    includeTitleSlide,
    includeSummarySlide,
    status: 'generating',
    createdAt: now,
    updatedAt: now,
    ttl,
  };

  const command = new PutCommand({
    TableName: PPTX_GENERATIONS_TABLE,
    Item: item,
  });

  await docClient.send(command);
  console.log(`Created PPTX generation: ${generationId}`);
  return item;
}

export async function findGenerationById(generationId: string): Promise<PptxGeneration | null> {
  const command = new QueryCommand({
    TableName: PPTX_GENERATIONS_TABLE,
    KeyConditionExpression: 'generationId = :generationId',
    ExpressionAttributeValues: {
      ':generationId': generationId,
    },
  });

  const response = await docClient.send(command);
  const items = response.Items;

  if (!items || items.length === 0) {
    return null;
  }

  return items[0] as PptxGeneration;
}

export async function findGenerationsByUser(
  userId: string,
  limit: number = 20,
  offset: number = 0
): Promise<PptxGeneration[]> {
  const command = new QueryCommand({
    TableName: PPTX_GENERATIONS_TABLE,
    IndexName: 'UserGenerationsIndex',
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': userId,
    },
    ScanIndexForward: false, // Sort by createdAt DESC
    Limit: limit + offset,
  });

  const response = await docClient.send(command);
  const items = response.Items || [];

  return items.slice(offset, offset + limit) as PptxGeneration[];
}

export async function updateGenerationStatus(
  generationId: string,
  userId: string,
  status: 'generating' | 'completed' | 'failed',
  s3OutputKey?: string,
  errorMessage?: string,
  slides?: any[]
): Promise<void> {
  let updateExpression = 'SET #status = :status, updatedAt = :updatedAt';
  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  if (s3OutputKey) {
    updateExpression += ', s3OutputKey = :s3OutputKey';
    expressionAttributeValues[':s3OutputKey'] = s3OutputKey;
  }

  if (errorMessage) {
    updateExpression += ', errorMessage = :errorMessage';
    expressionAttributeValues[':errorMessage'] = errorMessage;
  }

  if (slides) {
    updateExpression += ', slides = :slides';
    expressionAttributeValues[':slides'] = slides;
  }

  const command = new UpdateCommand({
    TableName: PPTX_GENERATIONS_TABLE,
    Key: {
      generationId,
      userId,
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  });

  await docClient.send(command);
  console.log(`Updated generation status: ${generationId} -> ${status}`);
}