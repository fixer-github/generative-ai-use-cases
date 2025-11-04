import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from 'aws-lambda';
import { updateTenant } from './tenantManager';
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';
import https from 'https';
import { URL } from 'url';

const cfnClient = new CloudFormationClient({});

/**
 * Send response to CloudFormation
 */
async function sendResponse(
  event: CloudFormationCustomResourceEvent,
  response: CloudFormationCustomResourceResponse
): Promise<void> {
  const responseBody = JSON.stringify(response);

  console.log('Sending response to CloudFormation:', responseBody);

  const parsedUrl = new URL(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length,
    },
  };

  return new Promise((resolve, reject) => {
    const request = https.request(options, (res) => {
      console.log(`CloudFormation response status: ${res.statusCode}`);
      resolve();
    });

    request.on('error', (error) => {
      console.error('Failed to send response to CloudFormation:', error);
      reject(error);
    });

    request.write(responseBody);
    request.end();
  });
}

interface TenantOpenSearchMappingRequest {
  tenantId: string;
  openSearchStackName: string;
  openSearchIndexName?: string;
}

/**
 * Custom Resource handler for mapping tenant OpenSearch endpoints
 *
 * This Lambda is invoked when tenant OpenSearch stacks are deployed/updated.
 * It reads the OpenSearch domain endpoint from CloudFormation stack outputs
 * and updates the tenant record in DynamoDB.
 *
 * @param event CloudFormation Custom Resource event
 * @returns Custom Resource response
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent
): Promise<void> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const requestType = event.RequestType;
  const properties = event.ResourceProperties as TenantOpenSearchMappingRequest;

  let response: CloudFormationCustomResourceResponse;

  try {
    if (requestType === 'Delete') {
      // On stack deletion, optionally clear OpenSearch config from tenant
      // For now, we keep it for reference
      console.log(
        `Delete request for tenant ${properties.tenantId} - keeping OpenSearch config`
      );

      response = {
        Status: 'SUCCESS',
        PhysicalResourceId: `tenant-opensearch-mapping-${properties.tenantId}`,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: {},
      };

      await sendResponse(event, response);
      return;
    }

    // Create or Update - sync OpenSearch endpoint to tenant
    const { tenantId, openSearchStackName, openSearchIndexName } = properties;

    if (!tenantId || !openSearchStackName) {
      throw new Error('Missing required properties: tenantId, openSearchStackName');
    }

    console.log(
      `${requestType} tenant-OpenSearch mapping for tenant ${tenantId} from stack ${openSearchStackName}`
    );

    // Get OpenSearch stack outputs
    const stackResponse = await cfnClient.send(
      new DescribeStacksCommand({
        StackName: openSearchStackName,
      })
    );

    const stack = stackResponse.Stacks?.[0];
    if (!stack || !stack.Outputs) {
      throw new Error(
        `Stack ${openSearchStackName} not found or has no outputs`
      );
    }

    // Extract outputs (using actual output key names from stack)
    const endpoint = stack.Outputs.find(
      (o) => o.OutputKey === 'DomainEndpoint'
    )?.OutputValue;

    const domainArn = stack.Outputs.find(
      (o) => o.OutputKey === 'DomainArn'
    )?.OutputValue;

    if (!endpoint) {
      throw new Error(
        `DomainEndpoint output not found in stack ${openSearchStackName}`
      );
    }

    console.log(
      `Retrieved OpenSearch endpoint for tenant ${tenantId}: ${endpoint}`
    );

    // Update tenant with OpenSearch configuration
    await updateTenant({
      tenantId,
      openSearchEndpoint: endpoint,
      openSearchDomainArn: domainArn,
      openSearchIndexName: openSearchIndexName || 'assistant-docs',
    });

    console.log(
      `Successfully updated tenant ${tenantId} with OpenSearch configuration`
    );

    response = {
      Status: 'SUCCESS',
      PhysicalResourceId: `tenant-opensearch-mapping-${tenantId}`,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {
        TenantId: tenantId,
        OpenSearchEndpoint: endpoint,
        OpenSearchDomainArn: domainArn || '',
        OpenSearchIndexName: openSearchIndexName || 'assistant-docs',
      },
    };

    await sendResponse(event, response);
  } catch (error) {
    console.error('Error in tenant-OpenSearch mapper:', error);

    response = {
      Status: 'FAILED',
      Reason: error instanceof Error ? error.message : 'Unknown error',
      PhysicalResourceId:
        event.PhysicalResourceId ||
        `tenant-opensearch-mapping-${properties.tenantId}`,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: {},
    };

    await sendResponse(event, response);
  }
};
