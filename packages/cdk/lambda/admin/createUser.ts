import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { CreateUserRequest, AdminUser } from 'generative-ai-use-cases';
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

    const req: CreateUserRequest = JSON.parse(event.body!);

    if (!req.email) {
      return errorResponse(400, 'email is required');
    }

    const createResult = await client.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: req.email,
        UserAttributes: [
          { Name: 'email', Value: req.email },
          { Name: 'email_verified', Value: 'true' },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
      })
    );

    const createdUser = createResult.User!;

    // Add user to specified groups
    if (req.groups && req.groups.length > 0) {
      await Promise.all(
        req.groups.map((group) =>
          client.send(
            new AdminAddUserToGroupCommand({
              UserPoolId: USER_POOL_ID,
              Username: createdUser.Username!,
              GroupName: group,
            })
          )
        )
      );
    }

    const groupsResult = await client.send(
      new AdminListGroupsForUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: createdUser.Username!,
      })
    );

    const user: AdminUser = {
      username: createdUser.Username!,
      email: req.email,
      status: createdUser.UserStatus ?? 'UNKNOWN',
      enabled: createdUser.Enabled ?? true,
      groups: (groupsResult.Groups ?? []).map((g) => g.GroupName!),
      createdDate: createdUser.UserCreateDate?.toISOString() ?? '',
      lastModifiedDate: createdUser.UserLastModifiedDate?.toISOString() ?? '',
    };

    return successResponse({ user }, 201);
  } catch (error) {
    console.log(error);
    if ((error as { name?: string }).name === 'UsernameExistsException') {
      return errorResponse(409, 'User already exists');
    }
    return errorResponse(500, 'Internal Server Error');
  }
};
