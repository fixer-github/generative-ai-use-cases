import {
  CognitoIdentityProviderClient,
  GroupType,
  ListGroupsCommand,
  ListUsersCommand,
  ListUsersInGroupCommand,
  UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ScheduledEvent } from 'aws-lambda';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const EXPORT_BUCKET_NAME = process.env.EXPORT_BUCKET_NAME!;

const cognitoClient = new CognitoIdentityProviderClient({});
const s3Client = new S3Client({});

// Retrieve all users with pagination
const listAllUsers = async (): Promise<UserType[]> => {
  const users: UserType[] = [];
  let paginationToken: string | undefined;

  do {
    const response = await cognitoClient.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        PaginationToken: paginationToken,
      })
    );
    users.push(...(response.Users ?? []));
    paginationToken = response.PaginationToken;
  } while (paginationToken);

  return users;
};

// Retrieve all groups with pagination
const listAllGroups = async (): Promise<GroupType[]> => {
  const groups: GroupType[] = [];
  let nextToken: string | undefined;

  do {
    const response = await cognitoClient.send(
      new ListGroupsCommand({
        UserPoolId: USER_POOL_ID,
        NextToken: nextToken,
      })
    );
    groups.push(...(response.Groups ?? []));
    nextToken = response.NextToken;
  } while (nextToken);

  return groups;
};

// Retrieve all usernames belonging to a specified group with pagination
const listUsernamesInGroup = async (groupName: string): Promise<string[]> => {
  const usernames: string[] = [];
  let nextToken: string | undefined;

  do {
    const response = await cognitoClient.send(
      new ListUsersInGroupCommand({
        UserPoolId: USER_POOL_ID,
        GroupName: groupName,
        NextToken: nextToken,
      })
    );
    for (const user of response.Users ?? []) {
      if (user.Username) usernames.push(user.Username);
    }
    nextToken = response.NextToken;
  } while (nextToken);

  return usernames;
};

// YYYY-MM-DD (UTC-based, for daily path prefix)
const formatDate = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

// Cognito Export Lambda triggered daily by an EventBridge schedule.
// Aggregates all users, groups, and group membership mappings under the UserPool
// into a single JSON file stored at cognito-exports/YYYY-MM-DD/users.json in S3.
export const handler = async (event: ScheduledEvent): Promise<void> => {
  console.log('Cognito export started:', JSON.stringify(event));

  const exportedAt = new Date();

  const [users, groups] = await Promise.all([listAllUsers(), listAllGroups()]);

  const groupMemberships: Record<string, string[]> = {};
  for (const group of groups) {
    if (!group.GroupName) continue;
    groupMemberships[group.GroupName] = await listUsernamesInGroup(
      group.GroupName
    );
  }

  const payload = {
    exportedAt: exportedAt.toISOString(),
    userPoolId: USER_POOL_ID,
    userCount: users.length,
    groupCount: groups.length,
    users,
    groups,
    groupMemberships,
  };

  const objectKey = `cognito-exports/${formatDate(exportedAt)}/users.json`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: EXPORT_BUCKET_NAME,
      Key: objectKey,
      Body: JSON.stringify(payload, null, 2),
      ContentType: 'application/json',
    })
  );

  console.log(
    `Cognito export completed: users=${users.length} groups=${groups.length} key=${objectKey}`
  );
};
