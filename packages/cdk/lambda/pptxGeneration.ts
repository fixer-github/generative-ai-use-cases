import { SQSEvent, SQSRecord } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import PptxGenJS from 'pptxgenjs';
import { getPptxGenerationsTableName, getPptxTemplatesBucketName, getPptxOutputsBucketName } from './pptx/tenantPptxConfig';
import { loadTemplate } from './pptx/pptxService';

// Initialize AWS clients
const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

interface GenerationMessage {
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

interface SlideContent {
  slide_number: number;
  title: string;
  content: string;
  layout: string;
  notes?: string;
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('Processing PPTX generation requests:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    await processGenerationRecord(record);
  }
};

async function processGenerationRecord(record: SQSRecord): Promise<void> {
  try {
    const message: GenerationMessage = JSON.parse(record.body);
    console.log('Processing generation:', message.generation_id);

    await updateGenerationStatus(message.generation_id, message.user_id, message.tenant_id, 'generating');

    // Extract slide content from instructions
    const slides = extractSlidesFromInstructions(message);

    // Load template if provided
    let templateBuffer: Buffer | undefined;
    if (message.template_s3_key) {
      templateBuffer = await loadTemplate(message.tenant_id, message.template_s3_key);
    }

    // Generate PPTX
    const pptxBuffer = await generatePptx(slides, templateBuffer);

    // Upload to S3
    const outputKey = `outputs/${message.tenant_id}/${message.user_id}/${message.generation_id}.pptx`;
    await uploadPptx(message.tenant_id, outputKey, pptxBuffer);

    // Update generation status to completed
    await updateGenerationStatus(
      message.generation_id,
      message.user_id,
      message.tenant_id,
      'completed',
      outputKey,
      undefined,
      slides
    );

    console.log('Completed generation:', message.generation_id);

  } catch (error) {
    console.error('Failed to process generation:', error);

    const message: GenerationMessage = JSON.parse(record.body);
    await updateGenerationStatus(
      message.generation_id,
      message.user_id,
      message.tenant_id,
      'failed',
      undefined,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

function extractSlidesFromInstructions(message: GenerationMessage): SlideContent[] {
  const slides: SlideContent[] = [];
  let currentSlideNumber = 1;

  // Add title slide if requested
  if (message.include_title_slide !== false) {
    const titleLines = message.instructions.split('\n').filter(line => line.trim());
    const title = titleLines[0] || 'Presentation';
    const subtitle = titleLines[1] || 'Generated with AI';

    slides.push({
      slide_number: currentSlideNumber,
      title,
      content: subtitle,
      layout: 'title',
    });
    currentSlideNumber++;
  }

  // Parse instructions to extract slide content
  const lines = message.instructions.split('\n');
  let currentSlideTitle = '';
  let currentSlideContent: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check if line looks like a slide title
    const isSlideTitle = 
      trimmedLine.startsWith('#') ||
      (trimmedLine.length < 50 && trimmedLine.endsWith(':')) ||
      trimmedLine.toLowerCase().startsWith('slide ');

    if (isSlideTitle) {
      // Save previous slide if we have content
      if (currentSlideTitle && currentSlideContent.length > 0) {
        slides.push({
          slide_number: currentSlideNumber,
          title: currentSlideTitle,
          content: currentSlideContent.join('\n'),
          layout: 'content',
        });
        currentSlideNumber++;
      }

      // Start new slide
      currentSlideTitle = trimmedLine.replace(/^#+\s*/, '').replace(/:$/, '').trim();
      currentSlideContent = [];
    } else {
      // Add to current slide content
      currentSlideContent.push(trimmedLine);
    }
  }

  // Add final slide if we have content
  if (currentSlideTitle && currentSlideContent.length > 0) {
    slides.push({
      slide_number: currentSlideNumber,
      title: currentSlideTitle,
      content: currentSlideContent.join('\n'),
      layout: 'content',
    });
    currentSlideNumber++;
  }

  // If no slides were extracted, create a single content slide
  if (slides.length === (message.include_title_slide !== false ? 1 : 0)) {
    slides.push({
      slide_number: currentSlideNumber,
      title: 'Content',
      content: message.instructions,
      layout: 'content',
    });
    currentSlideNumber++;
  }

  // Add summary slide if requested
  if (message.include_summary_slide) {
    const summaryPoints = [
      '• Key points covered in this presentation',
      '• Important takeaways',
      '• Next steps',
    ];

    slides.push({
      slide_number: currentSlideNumber,
      title: 'Summary',
      content: summaryPoints.join('\n'),
      layout: 'content',
    });
  }

  // Limit to requested slide count if specified
  if (message.slide_count && slides.length > message.slide_count) {
    return slides.slice(0, message.slide_count);
  }

  return slides;
}

async function generatePptx(slides: SlideContent[], templateBuffer?: Buffer): Promise<Buffer> {
  console.log('Generating PPTX with', slides.length, 'slides');

  const pptx = new PptxGenJS();

  // Apply template if provided
  if (templateBuffer) {
    // Note: PptxGenJS doesn't directly support loading from buffer
    // In a production environment, you might need to save to temp file first
    console.log('Template provided but loading from buffer not directly supported');
  }

  // Configure presentation properties
  pptx.author = 'AI Assistant';
  pptx.company = 'Generated Presentations';
  pptx.subject = 'AI Generated Presentation';
  pptx.title = slides.find(s => s.layout === 'title')?.title || 'Presentation';

  // Generate slides
  for (const slideData of slides) {
    const slide = pptx.addSlide();

    if (slideData.layout === 'title') {
      // Title slide layout
      slide.addText(slideData.title, {
        x: 0.5,
        y: 2.0,
        w: 9.0,
        h: 1.5,
        fontSize: 44,
        fontFace: 'Arial',
        color: '363636',
        align: 'center',
        bold: true,
      });

      slide.addText(slideData.content, {
        x: 0.5,
        y: 3.5,
        w: 9.0,
        h: 1.0,
        fontSize: 24,
        fontFace: 'Arial',
        color: '666666',
        align: 'center',
      });
    } else {
      // Content slide layout
      slide.addText(slideData.title, {
        x: 0.5,
        y: 0.5,
        w: 9.0,
        h: 1.0,
        fontSize: 32,
        fontFace: 'Arial',
        color: '363636',
        bold: true,
      });

      // Split content into bullet points if it contains line breaks
      const contentLines = slideData.content.split('\n').filter(line => line.trim());
      
      if (contentLines.length > 1) {
        // Multi-line content as bullet points
        const bulletPoints = contentLines.map(line => {
          const trimmed = line.trim();
          return trimmed.startsWith('•') || trimmed.startsWith('-') 
            ? trimmed.slice(1).trim()
            : trimmed;
        });

        slide.addText(bulletPoints, {
          x: 0.5,
          y: 1.5,
          w: 9.0,
          h: 5.0,
          fontSize: 18,
          fontFace: 'Arial',
          color: '363636',
          bullet: true,
        });
      } else {
        // Single paragraph content
        slide.addText(slideData.content, {
          x: 0.5,
          y: 1.5,
          w: 9.0,
          h: 5.0,
          fontSize: 18,
          fontFace: 'Arial',
          color: '363636',
        });
      }
    }

    // Add slide notes if provided
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }
  }

  // Generate the PPTX file as buffer
  const pptxData = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(pptxData);
}

async function uploadPptx(tenantId: string, s3Key: string, buffer: Buffer): Promise<void> {
  const bucket = await getPptxOutputsBucketName(tenantId);

  console.log('Uploading PPTX to:', { bucket, s3Key, tenantId });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    Body: buffer,
    ContentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ContentDisposition: 'attachment; filename="presentation.pptx"',
  });

  await s3Client.send(command);
}

async function updateGenerationStatus(
  generationId: string,
  userId: string,
  tenantId: string,
  status: string,
  s3OutputKey?: string,
  errorMessage?: string,
  slides?: SlideContent[]
): Promise<void> {
  console.log('Updating generation status:', generationId, status);

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
    TableName: getPptxGenerationsTableName(tenantId),
    Key: {
      generationId,
      userId,
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  });

  await docClient.send(command);
}