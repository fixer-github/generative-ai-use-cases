import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { deleteMeeting } from './repository';

const BUCKET_NAME: string = process.env.MEETING_BUCKET_NAME!;
const s3 = new S3Client({});

const deleteObject = async (key?: string) => {
  if (!key) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  } catch (error) {
    console.log('Failed to delete meeting object', key, error);
  }
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];
    const meetingId = event.pathParameters!.meetingId!;

    // Delete the meeting body (MeetingTable) and its projection row, then clean
    // up the S3 objects it pointed at (transcript / minutes / audio).
    const meeting = await deleteMeeting(userId, meetingId);
    if (meeting) {
      await Promise.all([
        deleteObject(meeting.transcriptKey),
        deleteObject(meeting.minutesKey),
        deleteObject(meeting.audioKey),
      ]);
    }

    return {
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: '',
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
