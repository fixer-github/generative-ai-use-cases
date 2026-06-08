import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  GetMeetingAudioUploadUrlRequest,
  GetMeetingAudioUploadUrlResponse,
} from 'generative-ai-use-cases';

const BUCKET_NAME: string = process.env.MEETING_BUCKET_NAME!;
const s3 = new S3Client({});

// Only allow a small set of container extensions the recorder can produce, so a
// bad client cannot steer the key to an arbitrary path. Default to webm.
const ALLOWED_EXT = new Set(['webm', 'mp4', 'ogg', 'm4a']);

// The audio object lives alongside the meeting's other bodies (transcript.json
// / minutes.json) in the meeting bucket, so deleteMeeting's cleanup removes it
// too. The key is fully scoped by the caller's userId. See Phase 2 memo B7.
const audioKeyOf = (userId: string, meetingId: string, ext: string) =>
  `meetings/${userId}/${meetingId}/audio.${ext}`;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const meetingId = event.pathParameters!.meetingId!;
    const req: GetMeetingAudioUploadUrlRequest = event.body
      ? JSON.parse(event.body)
      : {};
    const ext =
      req.ext && ALLOWED_EXT.has(req.ext.toLowerCase())
        ? req.ext.toLowerCase()
        : 'webm';

    const audioKey = audioKeyOf(userId, meetingId, ext);
    // Content-Type is left unsigned so the browser can PUT the blob with its own
    // MIME type, matching the batch upload flow (getFileUploadSignedUrl).
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: audioKey,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });

    const body: GetMeetingAudioUploadUrlResponse = { url, audioKey };
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(body),
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
