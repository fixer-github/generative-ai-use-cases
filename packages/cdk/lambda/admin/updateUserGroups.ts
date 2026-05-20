import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { UpdateUserGroupsRequest } from 'generative-ai-use-cases';
import { isAdmin, getUserId, successResponse, errorResponse } from './utils';

const client = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return errorResponse(403, 'Admin access required');
    }

    const username = event.pathParameters!.username!;
    const req: UpdateUserGroupsRequest = JSON.parse(event.body!);
    const currentUser = getUserId(event);

    // Prevent removing admin role from self
    if (username === currentUser && !req.groups.includes('admin')) {
      return errorResponse(
        400,
        'Cannot remove admin role from your own account'
      );
    }

    // Get current groups
    const currentGroupsResult = await client.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
      })
    );
    const currentGroups = (currentGroupsResult.Groups ?? []).map(
      (g) => g.GroupName!
    );

    const desiredGroups = req.groups;
    const toAdd = desiredGroups.filter((g) => !currentGroups.includes(g));
    const toRemove = currentGroups.filter((g) => !desiredGroups.includes(g));

    await Promise.all([
      ...toAdd.map((group) =>
        client.send(
          new AdminAddUserToGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: username,
            GroupName: group,
          })
        )
      ),
      ...toRemove.map((group) =>
        client.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: username,
            GroupName: group,
          })
        )
      ),
    ]);

    return successResponse({
      username,
      groups: desiredGroups,
    });
  } catch (error) {
    console.log(error);
    if ((error as { name?: string }).name === 'UserNotFoundException') {
      return errorResponse(404, 'User not found');
    }
    return errorResponse(500, 'Internal Server Error');
  }
};
