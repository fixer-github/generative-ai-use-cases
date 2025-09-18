import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { TenantRegistrationData } from '../../types/tenant-registration';

export interface TenantRegistrationStackProps extends cdk.StackProps {
  /**
   * The tenant identifier
   */
  readonly tenantId: string;

  /**
   * The environment (e.g., dev, staging, prod)
   */
  readonly environment: string;

  /**
   * IAM Role ARN from TenantIAMStack
   */
  readonly iamRoleArn: string;

  /**
   * BedrockChat API Lambda ARN from TenantBedrockChatStack (optional)
   */
  readonly bedrockChatApiArn?: string;


  /**
   * Description for the stack
   * @default 'Tenant registration stack for {tenantId}'
   */
  readonly description?: string;
}

/**
 * Stack for registering tenant resources to the main stack's tenant database
 * This stack should be deployed last, after all other tenant stacks
 */
export class TenantRegistrationStack extends cdk.Stack {
  /**
   * The tenant ID
   */
  public readonly tenantId: string;

  constructor(scope: Construct, id: string, props: TenantRegistrationStackProps) {
    super(scope, id, props);

    // Get tenant ID from props (required)
    this.tenantId = props.tenantId;

    // Get environment (required parameter)
    const environment = props.environment;

    // Get tenant registration API endpoint and key from context
    const registrationApiEndpoint = this.node.tryGetContext('registrationApiEndpoint');
    const registrationApiKey = this.node.tryGetContext('registrationApiKey');

    if (!registrationApiEndpoint) {
      throw new Error(
        'registrationApiEndpoint must be provided via context (--context registrationApiEndpoint=<value> or in cdk.tenant.json)'
      );
    }
    if (!registrationApiKey) {
      throw new Error(
        'registrationApiKey must be provided via context (--context registrationApiKey=<value> or in cdk.tenant.json)'
      );
    }

    // Prepare registration data
    const registrationData: TenantRegistrationData = {
      tenantId: this.tenantId,
      accountId: this.account,
      region: this.region,
      environment: environment,
      roleArn: props.iamRoleArn,
      bedrockChatApiArn: props.bedrockChatApiArn,
    };

    // Create a Lambda to call the registration API
    const registerTenantLambda = new NodejsFunction(this, 'RegisterTenant', {
      functionName: `tenant-registration-${this.tenantId}`,
      runtime: Runtime.NODEJS_18_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      code: Code.fromInline(`
        const https = require('https');
        const { URL } = require('url');

        // Send response to CloudFormation
        const sendResponse = async (event, status, reason, physicalResourceId, data = {}) => {
          const responseBody = JSON.stringify({
            Status: status,
            Reason: reason,
            PhysicalResourceId: physicalResourceId,
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            NoEcho: false,
            Data: data,
          });

          console.log('Sending CloudFormation response:', responseBody);

          const responseUrl = new URL(event.ResponseURL);
          const options = {
            hostname: responseUrl.hostname,
            port: 443,
            path: responseUrl.pathname + responseUrl.search,
            method: 'PUT',
            headers: {
              'Content-Type': '',
              'Content-Length': responseBody.length,
            },
          };

          return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
              console.log('CloudFormation response status:', res.statusCode);
              resolve();
            });

            req.on('error', (error) => {
              console.error('Failed to send CloudFormation response:', error);
              reject(error);
            });

            req.write(responseBody);
            req.end();
          });
        };

        exports.handler = async (event, context) => {
          console.log('Event:', JSON.stringify(event, null, 2));

          const physicalResourceId = event.PhysicalResourceId || 'tenant-registration-${this.tenantId}';

          try {
            if (event.RequestType === 'Delete') {
              // For deletion, we might want to call the API to mark tenant as deleted
              // For now, just return success
              await sendResponse(event, 'SUCCESS', 'Delete completed successfully', physicalResourceId);
              return;
            }

            if (event.RequestType === 'Update') {
              // For updates, re-register with updated data
              // Continue to the registration logic below
            }

            // Handle Create and Update requests
            const endpoint = '${registrationApiEndpoint}';
            const apiKey = '${registrationApiKey}';

            // Registration data with all information
            const data = JSON.stringify(${JSON.stringify(registrationData)});

            console.log('Calling registration API:', endpoint);
            console.log('Registration data:', data);

            const url = new URL(endpoint);
            const options = {
              hostname: url.hostname,
              port: 443,
              path: url.pathname,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length,
                'x-api-key': apiKey,
              },
            };

            await new Promise((resolve, reject) => {
              const req = https.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', async () => {
                  console.log('API Response Status:', res.statusCode);
                  console.log('API Response Body:', body);

                  if (res.statusCode === 200 || res.statusCode === 409) {
                    // 200 = success, 409 = already exists (acceptable)
                    await sendResponse(event, 'SUCCESS', 'Tenant registered successfully', physicalResourceId, {
                      registered: true,
                      tenantId: '${this.tenantId}',
                      hasBedrockChat: ${props.bedrockChatApiArn ? 'true' : 'false'}
                    });
                    resolve();
                  } else {
                    const errorMsg = 'Registration API call failed with status ' + res.statusCode + ': ' + body;
                    await sendResponse(event, 'FAILED', errorMsg, physicalResourceId);
                    reject(new Error(errorMsg));
                  }
                });
              });

              req.on('error', async (error) => {
                console.error('Request error:', error);
                await sendResponse(event, 'FAILED', 'Request error: ' + error.message, physicalResourceId);
                reject(error);
              });

              req.write(data);
              req.end();
            });

          } catch (error) {
            console.error('Lambda execution error:', error);
            await sendResponse(event, 'FAILED', 'Lambda execution error: ' + error.message, physicalResourceId);
            throw error;
          }
        };
      `),
    });

    // Create Custom Resource using the local Lambda
    new cdk.CustomResource(this, 'TenantRegistration', {
      serviceToken: registerTenantLambda.functionArn,
      resourceType: 'Custom::TenantRegistration',
    });

    // Add stack-level outputs
    new cdk.CfnOutput(this, 'RegistrationStatus', {
      value: 'Registered',
      description: `Registration status for tenant ${this.tenantId}`,
      exportName: `${this.stackName}-RegistrationStatus`,
    });

    new cdk.CfnOutput(this, 'RegisteredTenantId', {
      value: this.tenantId,
      description: `Registered tenant ID`,
      exportName: `${this.stackName}-TenantId`,
    });

    if (props.bedrockChatApiArn) {
      new cdk.CfnOutput(this, 'RegisteredBedrockChatApiArn', {
        value: props.bedrockChatApiArn,
        description: `Registered BedrockChat API ARN for tenant ${this.tenantId}`,
        exportName: `${this.stackName}-BedrockChatApiArn`,
      });
    }

    // Add tags
    cdk.Tags.of(this).add('TenantId', this.tenantId.toString());
    cdk.Tags.of(this).add('Environment', environment);
    cdk.Tags.of(this).add('Purpose', 'TenantRegistration');

    // Set stack description
    this.templateOptions.description =
      props?.description ||
      `Registers tenant resources to main stack database for tenant ${this.tenantId}`;
  }
}