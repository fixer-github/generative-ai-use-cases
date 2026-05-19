import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { AdminUser } from 'generative-ai-use-cases';
import { isAdmin, successResponse, errorResponse } from './utils';

const client = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return errorResponse(403, 'Admin access required');
    }

    const paginationToken =
      event?.queryStringParameters?.paginationToken ?? undefined;

    const listResult = await client.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Limit: 60,
        PaginationToken: paginationToken || undefined,
      })
    );

    const users: AdminUser[] = await Promise.all(
      (listResult.Users ?? []).map(async (user) => {
        const groupsResult = await client.send(
          new AdminListGroupsForUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: user.Username!,
          })
        );

        const email =
          user.Attributes?.find((a) => a.Name === 'email')?.Value ?? '';

        return {
          username: user.Username!,
          email,
          status: user.UserStatus ?? 'UNKNOWN',
          enabled: user.Enabled ?? true,
          groups: (groupsResult.Groups ?? []).map((g) => g.GroupName!),
          createdDate: user.UserCreateDate?.toISOString() ?? '',
          lastModifiedDate: user.UserLastModifiedDate?.toISOString() ?? '',
        };
      })
    );

    return successResponse({
      users,
      paginationToken: listResult.PaginationToken,
    });
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
