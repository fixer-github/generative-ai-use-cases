import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
  UserPoolType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  UpdatePasswordPolicyRequest,
  PasswordPolicy,
} from 'generative-ai-use-cases';
import { isAdmin, successResponse, errorResponse } from './utils';

const client = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID!;

// Guardrails: minimum acceptable values
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 20;

const validatePolicy = (policy: PasswordPolicy): string | null => {
  if (
    policy.minimumLength < MIN_PASSWORD_LENGTH ||
    policy.minimumLength > MAX_PASSWORD_LENGTH
  ) {
    return `minimumLength must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH}`;
  }
  // Numbers and lowercase are always required (guardrail)
  if (!policy.requireNumbers) {
    return 'requireNumbers must be true (guardrail)';
  }
  if (!policy.requireLowercase) {
    return 'requireLowercase must be true (guardrail)';
  }
  return null;
};

/**
 * Build UpdateUserPool input from the existing pool description,
 * replacing only the password policy. This avoids the UpdateUserPool
 * pitfall where omitted parameters revert to defaults.
 *
 * Read-only fields from DescribeUserPool are destructured out, and
 * everything else is spread into the update input so that newly added
 * Cognito properties are automatically preserved.
 */
const buildUpdateInput = (
  existing: UserPoolType,
  newPolicy: PasswordPolicy
) => {
  // These fields are read-only or immutable after creation and must
  // NOT be sent to UpdateUserPool.
  const readOnlyKeys = new Set([
    'Id',
    'Name',
    'Status',
    'Arn',
    'CreationDate',
    'LastModifiedDate',
    'EstimatedNumberOfUsers',
    'SchemaAttributes',
    'Domain',
    'CustomDomain',
    'UsernameAttributes',
    'AliasAttributes',
    'UsernameConfiguration',
    'SmsConfigurationFailure',
    'EmailConfigurationFailure',
    'Policies',
  ]);
  const preservedSettings = Object.fromEntries(
    Object.entries(existing).filter(([key]) => !readOnlyKeys.has(key))
  );

  return {
    UserPoolId: USER_POOL_ID,
    ...preservedSettings,
    Policies: {
      ...existing.Policies,
      PasswordPolicy: {
        ...existing.Policies?.PasswordPolicy,
        MinimumLength: newPolicy.minimumLength,
        RequireUppercase: newPolicy.requireUppercase,
        RequireLowercase: newPolicy.requireLowercase,
        RequireNumbers: newPolicy.requireNumbers,
        RequireSymbols: newPolicy.requireSymbols,
      },
    },
  };
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!isAdmin(event)) {
      return errorResponse(403, 'Admin access required');
    }

    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    const req: UpdatePasswordPolicyRequest = JSON.parse(event.body);
    const validationError = validatePolicy(req.policy);
    if (validationError) {
      return errorResponse(400, validationError);
    }

    // Step 1: Get existing User Pool configuration
    const describeResult = await client.send(
      new DescribeUserPoolCommand({
        UserPoolId: USER_POOL_ID,
      })
    );

    const existingPool = describeResult.UserPool!;

    // Step 2: Merge new password policy with existing config
    const updateInput = buildUpdateInput(existingPool, req.policy);

    // Step 3: Update with merged config
    await client.send(new UpdateUserPoolCommand(updateInput));

    return successResponse({ policy: req.policy });
  } catch (error) {
    console.log(error);
    return errorResponse(500, 'Internal Server Error');
  }
};
