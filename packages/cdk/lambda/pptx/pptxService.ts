import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuid4 } from 'uuid';

// Initialize AWS clients
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});

// Environment variables
const PPTX_TEMPLATES_BUCKET = process.env.PPTX_TEMPLATES_BUCKET!;
const PPTX_OUTPUTS_BUCKET = process.env.PPTX_OUTPUTS_BUCKET!;
const PPTX_GENERATION_QUEUE = process.env.PPTX_GENERATION_QUEUE!;

export interface PresignedUrlResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export interface GenerationMessage {
  generation_id: string;
  user_id: string;
  tenant_id: string;
  instructions: string;
  chat_id?: string;
  template_id?: string;
  template_s3_key?: string;
  slide_count?: number;
  include_title_slide?: boolean;
  include_summary_slide?: boolean;
  timestamp: string;
}

export async function generatePresignedUploadUrl(
  tenantId: string,
  userId: string,
  filename: string,
  contentType: string = 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  fileType: string = 'template'
): Promise<PresignedUrlResponse> {
  const bucket = fileType === 'template' ? PPTX_TEMPLATES_BUCKET : PPTX_OUTPUTS_BUCKET;
  const prefix = fileType === 'template'
    ? `templates/${tenantId}/${userId}`
    : `outputs/${tenantId}/${userId}`;

  if (!bucket) {
    throw new Error(`Bucket not configured for file type: ${fileType}`);
  }

  // Generate unique S3 key
  const fileExtension = filename.split('.').pop()?.toLowerCase() || 'pptx';
  const uniqueFilename = `${uuid4()}.${fileExtension}`;
  const s3Key = `${prefix}/${uniqueFilename}`;

  // Generate presigned PUT URL for upload with normalized Content-Type
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 3600, // 1 hour
  });

  console.log(`Generated presigned URL for upload: ${s3Key}`);

  return {
    uploadUrl: presignedUrl,
    s3Key,
    expiresIn: 3600,
  };
}

export async function getPptxDownloadUrl(
  s3Key: string,
  expiresIn: number = 3600
): Promise<string> {
  if (!PPTX_OUTPUTS_BUCKET) {
    throw new Error('PPTX outputs bucket not configured');
  }

  const command = new GetObjectCommand({
    Bucket: PPTX_OUTPUTS_BUCKET,
    Key: s3Key,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, {
    expiresIn,
  });

  console.log(`Generated presigned URL for download: ${s3Key}`);
  return presignedUrl;
}

export async function startPptxGeneration(
  generationId: string,
  userId: string,
  tenantId: string,
  instructions: string,
  chatId?: string,
  templateId?: string,
  templateS3Key?: string,
  slideCount?: number,
  includeTitleSlide: boolean = true,
  includeSummarySlide: boolean = false
): Promise<void> {
  if (!PPTX_GENERATION_QUEUE) {
    throw new Error('PPTX generation queue not configured');
  }

  // Prepare message for SQS
  const messageBody: GenerationMessage = {
    generation_id: generationId,
    user_id: userId,
    tenant_id: tenantId,
    instructions,
    chat_id: chatId,
    template_id: templateId,
    template_s3_key: templateS3Key,
    slide_count: slideCount,
    include_title_slide: includeTitleSlide,
    include_summary_slide: includeSummarySlide,
    timestamp: new Date().toISOString(),
  };

  const command = new SendMessageCommand({
    QueueUrl: PPTX_GENERATION_QUEUE,
    MessageBody: JSON.stringify(messageBody),
    MessageAttributes: {
      generation_id: {
        StringValue: generationId,
        DataType: 'String',
      },
      user_id: {
        StringValue: userId,
        DataType: 'String',
      },
      tenant_id: {
        StringValue: tenantId,
        DataType: 'String',
      },
    },
  });

  const response = await sqsClient.send(command);
  console.log(`Queued PPTX generation: ${generationId}, Message ID: ${response.MessageId}`);
}

export async function loadTemplate(s3Key: string): Promise<Buffer> {
  console.log('Loading template from S3:', s3Key);

  const command = new GetObjectCommand({
    Bucket: PPTX_TEMPLATES_BUCKET,
    Key: s3Key,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('Template file not found');
  }

  const chunks: Uint8Array[] = [];
  const stream = response.Body as any;

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export function validateSlideCount(slideCount?: number): boolean {
  if (slideCount === undefined) return true;
  return slideCount >= 1 && slideCount <= 50;
}

export function validateInstructions(instructions: string): boolean {
  return instructions.length >= 1 && instructions.length <= 5000;
}

export function validateFileExtension(filename: string): boolean {
  const lowerFilename = filename.toLowerCase();
  return lowerFilename.endsWith('.pptx') || lowerFilename.endsWith('.potx');
}
