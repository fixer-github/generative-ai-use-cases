import { v4 as uuidv4 } from 'uuid';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  LanguageCode,
} from '@aws-sdk/client-transcribe';
import { StartTranscriptionRequest } from 'generative-ai-use-cases';
import { encodeMeetingJobName } from './utils/meetingJobName';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const client = new TranscribeClient({});
    const req: StartTranscriptionRequest = JSON.parse(event.body!);
    // The `userId` tag stays claims.sub so getTranscription's ownership check
    // (which compares the tag to claims.sub) is unaffected.
    const userId = event.requestContext.authorizer!.claims.sub;
    // The meeting entity is keyed by cognito:username (createMeeting), so the
    // B3 job->meeting mapping must encode THAT identity, not sub.
    const cognitoUsername =
      event.requestContext.authorizer!.claims['cognito:username'];

    const { audioUrl, speakerLabel, maxSpeakers, languageCode, meetingId } =
      req;

    const uuid = uuidv4();
    // Meeting-linked batch jobs get a structured name so B3 can map the finished
    // job back to the meeting; legacy jobs keep a plain UUID (B3 ignores them).
    const jobName = meetingId
      ? encodeMeetingJobName(cognitoUsername, meetingId, uuid)
      : uuid;

    const command = new StartTranscriptionJobCommand({
      IdentifyLanguage: !languageCode, // Enable auto-detection when no language specified
      LanguageCode: languageCode ? (languageCode as LanguageCode) : undefined, // Use specified language when provided
      LanguageOptions: !languageCode ? ['ja-JP', 'en-US'] : undefined, // Language candidates for auto-detection only
      Media: { MediaFileUri: audioUrl },
      TranscriptionJobName: jobName,
      Settings: {
        ShowSpeakerLabels: speakerLabel,
        MaxSpeakerLabels: speakerLabel ? maxSpeakers : undefined,
      },
      OutputBucketName: process.env.TRANSCRIPT_BUCKET_NAME,
      Tags: [
        {
          Key: 'userId',
          Value: userId,
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
