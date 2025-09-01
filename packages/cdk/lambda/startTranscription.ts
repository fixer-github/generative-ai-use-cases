import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  LanguageCode,
} from '@aws-sdk/client-transcribe';
import { StartTranscriptionRequest } from 'generative-ai-use-cases';
import { getTenantId } from './utils/tenantUtils';
import { getTenantBucketNameByTenantId } from './utils/tenantS3Utils';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const client = new TranscribeClient({});
    const req: StartTranscriptionRequest = JSON.parse(event.body!);
    const userId = event.requestContext.authorizer!.claims.sub;

    // Extract tenant ID from Cognito claims
    const tenantId = getTenantId(event);
    console.log(
      `Starting transcription for tenant: ${tenantId}, user: ${userId}`
    );

    const { audioUrl, speakerLabel, maxSpeakers, languageCode } = req;

    const uuid = uuidv4();

    // Get tenant-specific transcript bucket
    const transcriptBucketName = await getTenantBucketNameByTenantId(
      tenantId,
      'transcripts'
    );
    console.log(`Using transcript bucket: ${transcriptBucketName}`);

    const command = new StartTranscriptionJobCommand({
      IdentifyLanguage: !languageCode, // Enable auto-detection when no language specified
      LanguageCode: languageCode ? (languageCode as LanguageCode) : undefined, // Use specified language when provided
      LanguageOptions: !languageCode ? ['ja-JP', 'en-US'] : undefined, // Language candidates for auto-detection only
      Media: { MediaFileUri: audioUrl },
      TranscriptionJobName: uuid,
      Settings: {
        ShowSpeakerLabels: speakerLabel,
        MaxSpeakerLabels: speakerLabel ? maxSpeakers : undefined,
      },
      OutputBucketName: transcriptBucketName,
      Tags: [
        {
          Key: 'userId',
          Value: userId,
        },
        {
          Key: 'tenantId',
          Value: tenantId,
        },
      ],
    });
    const res = await client.send(command);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        jobName: res.TranscriptionJob!.TranscriptionJobName,
      }),
    };
  } catch (error) {
    console.log(error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};
