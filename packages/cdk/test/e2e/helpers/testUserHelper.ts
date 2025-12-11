/**
 * Test User Helper for E2E Tests
 *
 * Creates and manages Cognito test users with admin role for E2E testing.
 * Test users are automatically cleaned up after tests.
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  MessageActionType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  InitiateAuthCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { fromEnv, fromIni } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { testConfig } from '../setup';
import { E2E_TEST_EMAIL_PREFIX } from './testDataFactory';

/**
 * Get credential provider based on available configuration.
 * Priority: Environment variables > AWS Profile
 */
function getCredentialProvider(): AwsCredentialIdentityProvider | undefined {
  // If AWS credentials are set as environment variables, use them
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return fromEnv();
  }

  // If AWS_PROFILE is set, try to use it
  if (process.env.AWS_PROFILE) {
    return fromIni({ profile: process.env.AWS_PROFILE });
  }

  // Let the SDK use default credential chain
  return undefined;
}

/**
 * Test user credentials
 */
export interface TestUserCredentials {
  username: string;
  password: string;
  token: string;
}

/**
 * Generate a secure password for test users
 */
function generateTestPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';

  // Ensure password meets Cognito requirements
  password += 'A'; // uppercase
  password += 'a'; // lowercase
  password += '1'; // number
  password += '!'; // symbol

  // Fill remaining characters
  for (let i = 4; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return password;
}

/**
 * Generate a unique test user email
 */
export function generateTestUserEmail(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${E2E_TEST_EMAIL_PREFIX}-admin-${timestamp}-${random}@example.com`;
}

/**
 * Test User Manager
 *
 * Creates admin test users for E2E testing and handles cleanup.
 */
export class TestUserManager {
  private client: CognitoIdentityProviderClient;
  private userPoolId: string;
  private clientId: string;
  private createdUsers: string[] = [];

  constructor() {
    const region = process.env.AWS_REGION || 'ap-northeast-1';
    const credentials = getCredentialProvider();

    this.client = new CognitoIdentityProviderClient({
      region,
      ...(credentials && { credentials }),
    });

    // Read directly from process.env which is set by setup.ts beforeAll
    this.userPoolId =
      process.env.E2E_COGNITO_USER_POOL_ID || testConfig.cognitoUserPoolId;
    this.clientId =
      process.env.E2E_COGNITO_CLIENT_ID || testConfig.cognitoClientId;

    if (!this.userPoolId || !this.clientId) {
      throw new Error(
        'Cognito configuration is incomplete. Please set E2E_COGNITO_USER_POOL_ID and E2E_COGNITO_CLIENT_ID.'
      );
    }
  }

  /**
   * Create a test user with admin role
   */
  async createAdminUser(tenantId: string): Promise<TestUserCredentials> {
    const username = generateTestUserEmail();
    const password = generateTestPassword();

    console.log(`Creating test admin user: ${username}`);

    try {
      // Create user with admin attributes
      await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          UserAttributes: [
            { Name: 'email', Value: username },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'custom:tenant_id', Value: tenantId },
            { Name: 'custom:tenantAdmin', Value: 'true' }, // Admin role
          ],
          TemporaryPassword: password,
          MessageAction: MessageActionType.SUPPRESS, // Don't send email
        })
      );

      // Set permanent password (skip force change password)
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          Password: password,
          Permanent: true,
        })
      );

      // Track for cleanup
      this.createdUsers.push(username);

      // Get auth token
      const token = await this.authenticateUser(username, password);

      console.log(`Test admin user created successfully: ${username}`);

      return {
        username,
        password,
        token,
      };
    } catch (error) {
      console.error(`Failed to create test user ${username}:`, error);
      // Try to clean up partial creation
      await this.deleteUser(username).catch(() => {});
      throw error;
    }
  }

  /**
   * Authenticate user and get token
   */
  private async authenticateUser(
    username: string,
    password: string
  ): Promise<string> {
    const response = await this.client.send(
      new InitiateAuthCommand({
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        ClientId: this.clientId,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
        },
      })
    );

    if (!response.AuthenticationResult?.IdToken) {
      throw new Error('Failed to get authentication token');
    }

    return response.AuthenticationResult.IdToken;
  }

  /**
   * Refresh token for an existing user
   */
  async refreshToken(username: string, password: string): Promise<string> {
    return this.authenticateUser(username, password);
  }

  /**
   * Delete a specific user
   */
  async deleteUser(username: string): Promise<void> {
    try {
      await this.client.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
        })
      );
      console.log(`Deleted test user: ${username}`);
    } catch (error: any) {
      if (error.name !== 'UserNotFoundException') {
        console.warn(`Failed to delete user ${username}:`, error.message);
      }
    }
  }

  /**
   * Check if user exists
   */
  async userExists(username: string): Promise<boolean> {
    try {
      await this.client.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
        })
      );
      return true;
    } catch (error: any) {
      if (error.name === 'UserNotFoundException') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Clean up all created test users
   */
  async cleanup(): Promise<void> {
    if (this.createdUsers.length === 0) {
      return;
    }

    console.log(`Cleaning up ${this.createdUsers.length} test users...`);

    for (const username of this.createdUsers) {
      await this.deleteUser(username);
    }

    this.createdUsers = [];
  }

  /**
   * Get list of created users (for debugging)
   */
  getCreatedUsers(): string[] {
    return [...this.createdUsers];
  }
}
