import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

// Allowed UUIDs for prompt template replacement
// IMPORTANT: Only these UUIDs will be replaced. Any other UUID format strings will be ignored.
const ALLOWED_UUIDS = [
  '31c84218-f632-4149-8369-a5432a8dd44b',
  'ee7f089a-2ad3-4930-8f16-9e6836068e74',
  'b8462158-e0f6-4159-b7de-d0de0fe70a43',
  'ca70d293-58d3-4e5f-9ab2-39eda1149c96',
  '4b5b8de6-23f3-432b-b77e-c09ab0497d16',
  '1bf69c10-0dcc-45cb-b75f-a4eca54b6266',
  '9415b084-d23d-4dd8-80c4-ebb86703f969',
  'd4587f8c-53d2-4bb3-9b89-602cf78f70bb',
  '8849c42f-f4fd-4a76-96d2-a031b4eea4d7',
  'b77ae680-7640-4404-a0f9-5fd700ece41d',
] as const;

const s3Client = new S3Client({});

/**
 * Fetches prompt template content from S3 for a given UUID.
 * The file format in S3 is: {uuid}_{任意の文字列}.txt
 *
 * @param bucketName - S3 bucket name
 * @param uuid - UUID to look up
 * @returns The content of the prompt template file
 * @throws Error if no matching file is found for the UUID
 */
async function fetchPromptTemplateFromS3(bucketName: string, uuid: string): Promise<string> {
  // List objects with the UUID prefix to find the matching file
  const listCommand = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: `${uuid}_`,
    MaxKeys: 1,
  });

  const listResult = await s3Client.send(listCommand);

  if (!listResult.Contents || listResult.Contents.length === 0) {
    throw new Error(`Prompt template file not found for UUID: ${uuid}. Expected file format: ${uuid}_*.txt`);
  }

  const fileKey = listResult.Contents[0].Key!;

  // Get the file content
  const getCommand = new GetObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
  });

  const getResult = await s3Client.send(getCommand);
  const content = await getResult.Body?.transformToString('utf-8');

  if (!content) {
    throw new Error(`Failed to read content from prompt template file: ${fileKey}`);
  }

  return content;
}

/**
 * Replaces {{UUID}} placeholders in the system message content with actual prompt templates from S3.
 *
 * - Only UUIDs in the ALLOWED_UUIDS list will be replaced
 * - If a UUID is in the allowed list but the corresponding S3 file doesn't exist, an error is thrown
 * - UUID format strings that are not in the allowed list will be ignored (not replaced)
 *
 * @param systemContent - The system message content containing {{UUID}} placeholders
 * @param bucketName - S3 bucket name where prompt templates are stored
 * @returns The system content with placeholders replaced by actual prompt templates
 */
export async function replacePromptTemplatePlaceholders(
  systemContent: string,
  bucketName: string
): Promise<string> {
  let result = systemContent;

  // Process each allowed UUID
  for (const uuid of ALLOWED_UUIDS) {
    const placeholder = `{{${uuid}}}`;

    if (result.includes(placeholder)) {
      // Fetch the template from S3 (throws error if file not found)
      const templateContent = await fetchPromptTemplateFromS3(bucketName, uuid);
      result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), templateContent);
    }
  }

  return result;
}

/**
 * Checks if the bucket name environment variable is set
 */
export function getPromptTemplateBucketName(): string | undefined {
  return process.env.PROMPT_TEMPLATES_BUCKET_NAME;
}
