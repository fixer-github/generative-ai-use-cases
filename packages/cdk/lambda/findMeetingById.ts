import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { MeetingTranscript, MeetingMinutesDoc } from 'generative-ai-use-cases';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { findMeetingById } from './repository';

const BUCKET_NAME: string = process.env.MEETING_BUCKET_NAME!;
const s3 = new S3Client({});

// Presign a GET URL for the recorded audio so the browser can play it back
// without downloading it through the API. Returns null when there is no audio.
const getAudioUrl = async (key?: string): Promise<string | null> => {
  if (!key) return null;
  try {
    return await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
      { expiresIn: 3600 }
    );
  } catch (error) {
    console.log('Failed to presign meeting audio', key, error);
    return null;
  }
};

// Read a JSON object from the meeting bucket. Returns null if the key is unset
// or missing (e.g. a meeting that has no minutes yet).
const getJson = async <T>(key?: string): Promise<T | null> => {
  if (!key) return null;
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key })
    );
    const body = await res.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : null;
  } catch (error) {
    console.log('Failed to read meeting body', key, error);
    return null;
  }
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const meetingId = event.pathParameters!.meetingId!;
    const meeting = await findMeetingById(userId, meetingId);

    // Resolve the heavy S3 bodies (transcript / minutes) so the workbench can
    // open a saved meeting in one round trip; presign the audio for playback.
    const [transcript, minutes, audioUrl] = meeting
      ? await Promise.all([
          getJson<MeetingTranscript>(meeting.transcriptKey),
          getJson<MeetingMinutesDoc>(meeting.minutesKey),
          getAudioUrl(meeting.audioKey),
        ])
      : [null, null, null];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        meeting,
        transcript,
        minutes,
        audioUrl,
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
