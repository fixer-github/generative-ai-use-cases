import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UpdateMeetingRequest } from 'generative-ai-use-cases';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { findMeetingById, updateMeeting } from './repository';

const BUCKET_NAME: string = process.env.MEETING_BUCKET_NAME!;
const s3 = new S3Client({});

// S3 object keys for a meeting's heavy bodies. DynamoDB only stores the key.
const transcriptKeyOf = (userId: string, meetingId: string) =>
  `meetings/${userId}/${meetingId}/transcript.json`;
const minutesKeyOf = (userId: string, meetingId: string) =>
  `meetings/${userId}/${meetingId}/minutes.json`;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const meetingId = event.pathParameters!.meetingId!;
    const { transcript, minutes, ...attrs }: UpdateMeetingRequest = JSON.parse(
      event.body!
    );

    const existing = await findMeetingById(userId, meetingId);
    if (!existing) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: '',
      };
    }

    // The DynamoDB-attribute patch. Start from the plain attrs, then layer in
    // the S3 keys / revisions derived from any bodies we persist below.
    const patch: UpdateMeetingRequest = { ...attrs };

    // Heavy bodies go to S3; DynamoDB gets the key + revision pointer.
    if (transcript) {
      const key = transcriptKeyOf(userId, meetingId);
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: JSON.stringify(transcript),
          ContentType: 'application/json',
        })
      );
      patch.transcriptKey = key;
      if (patch.rev === undefined) {
        patch.rev = transcript.rev;
      }
    }

    if (minutes) {
      const key = minutesKeyOf(userId, meetingId);
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: JSON.stringify(minutes),
          ContentType: 'application/json',
        })
      );
      patch.minutesKey = key;
      if (patch.genRev === undefined && minutes.genRev !== undefined) {
        patch.genRev = minutes.genRev;
      }
    }

    const meeting = await updateMeeting(userId, meetingId, patch);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ meeting }),
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
