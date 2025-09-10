import { randomUUID } from 'crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  BotCreateRequest,
  BotCreateRequestKnouledgeFile,
  BotEntity,
} from 'generative-ai-use-cases';
import * as repository from './repository';

const BUCKET_NAME: string = process.env.BUCKET_NAME!;

const saveFileToS3 = async (
  id: string,
  file: BotCreateRequestKnouledgeFile
): Promise<{ name: string; key: string }> => {
  const s3 = new S3Client({});

  const fileName = file.name;
  const contentType = file.contentType;
  const buffer = Buffer.from(file.content, 'base64');

  const key = `bot/knouledge/${id}/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3.send(command);

  return {
    name: fileName,
    key: key,
  };
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId: string =
      event.requestContext.authorizer!.claims['cognito:username'];

    const content = JSON.parse(event.body!) as BotCreateRequest;

    const files = content.knouledgeFiles;

    const id = randomUUID();
    const createdDate = new Date().toISOString();

    const fileSavedResults = await Promise.all(
      files.map((file) => saveFileToS3(id, file))
    );

    console.debug(JSON.stringify(fileSavedResults));

    const item: BotEntity = {
      id: id,
      createdDate: createdDate,
      userId: userId,
      title: content.title,
      description: content.description,
      promptTemplate: content.promptTemplate,
      publicInOrg: content.publicInOrg,
      useFixedModel: content.useFixedModel,
      modelId: content.modelId,
      fileAttachEnabled: content.fileAttachEnabled,
      knouledgeFiles: fileSavedResults,
    };

    const res = await repository.createBot(item, event);

    return {
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(res),
    };
  } catch (error) {
    console.error(error);

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
