import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { sdkStreamMixin } from '@smithy/util-stream-node';

const s3Client = new S3Client({});

/**
 * Parse S3 URL to extract bucket and key
 * @param s3Url S3 URL in format s3://bucket/key or https://bucket.s3.region.amazonaws.com/key
 */
function parseS3Url(s3Url: string): { bucket: string; key: string } {
  if (s3Url.startsWith('s3://')) {
    const withoutProtocol = s3Url.substring(5);
    const firstSlash = withoutProtocol.indexOf('/');
    return {
      bucket: withoutProtocol.substring(0, firstSlash),
      key: withoutProtocol.substring(firstSlash + 1),
    };
  }

  // Handle https URL format
  const url = new URL(s3Url);
  const bucket = url.hostname.split('.')[0];
  const key = url.pathname.substring(1); // Remove leading slash
  return { bucket, key };
}

/**
 * Load a document from S3
 * @param s3Url The S3 URL of the document
 * @returns Document with content and metadata
 */
async function loadDocumentFromS3(s3Url: string): Promise<Document> {
  try {
    const { bucket, key } = parseS3Url(s3Url);

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      throw new Error(`No body in response for ${s3Url}`);
    }

    // Convert stream to string
    const sdkStream = sdkStreamMixin(response.Body);
    const data = await sdkStream.transformToByteArray();
    const content = Buffer.from(data).toString('utf-8');

    // Determine content type from metadata or key extension
    const contentType =
      response.ContentType || getContentTypeFromKey(key) || 'text/plain';

    return new Document({
      pageContent: content,
      metadata: {
        s3Url,
        bucket,
        key,
        contentType,
        lastModified: response.LastModified?.toISOString(),
        size: response.ContentLength,
      },
    });
  } catch (error) {
    console.error(`Error loading document from ${s3Url}:`, error);
    throw error;
  }
}

/**
 * Determine content type from file extension
 */
function getContentTypeFromKey(key: string): string | null {
  const ext = key.split('.').pop()?.toLowerCase();
  const contentTypes: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    pdf: 'application/pdf',
    html: 'text/html',
    csv: 'text/csv',
  };
  return contentTypes[ext || ''] || null;
}

/**
 * Load documents from multiple S3 URLs
 * @param s3Urls Array of S3 URLs
 * @returns Array of documents
 */
export async function loadDocumentsFromS3(
  s3Urls: string[]
): Promise<Document[]> {
  try {
    const documents = await Promise.all(
      s3Urls.map((url) => loadDocumentFromS3(url))
    );

    console.log(`Successfully loaded ${documents.length} documents from S3`);
    return documents;
  } catch (error) {
    console.error('Error loading documents from S3:', error);
    throw error;
  }
}

/**
 * Chunk documents into smaller pieces for better retrieval
 * @param documents Array of documents to chunk
 * @param chunkSize Size of each chunk in characters
 * @param chunkOverlap Overlap between chunks
 * @returns Array of chunked documents
 */
export async function chunkDocuments(
  documents: Document[],
  chunkSize: number = 1000,
  chunkOverlap: number = 200
): Promise<Document[]> {
  try {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
    });

    const chunkedDocs = await splitter.splitDocuments(documents);

    console.log(
      `Chunked ${documents.length} documents into ${chunkedDocs.length} chunks`
    );
    return chunkedDocs;
  } catch (error) {
    console.error('Error chunking documents:', error);
    throw error;
  }
}

/**
 * Add metadata to documents
 * @param documents Array of documents
 * @param assistantId The assistant ID
 * @param userId The user ID
 * @returns Documents with added metadata
 */
export function addMetadata(
  documents: Document[],
  assistantId: string,
  userId: string
): Document[] {
  return documents.map(
    (doc) =>
      new Document({
        pageContent: doc.pageContent,
        metadata: {
          ...doc.metadata,
          assistantId,
          userId,
          indexedAt: new Date().toISOString(),
        },
      })
  );
}
