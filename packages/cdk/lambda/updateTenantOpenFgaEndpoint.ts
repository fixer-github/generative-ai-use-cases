/**
 * Custom Resource Lambda for updating tenant with OpenFGA endpoint
 * This is called after the OpenFGA stack is created
 */

import { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import { updateTenant } from './tenantManager';

interface ResourceProperties {
  TenantId: string;
  OpenFgaApiEndpoint: string;
  OpenFgaApiRegion: string;
}

/**
 * Send CloudFormation response
 */
async function sendResponse(
  event: CloudFormationCustomResourceEvent,
  status: 'SUCCESS' | 'FAILED',
  reason: string,
  physicalResourceId: string,
  data?: Record<string, any>
): Promise<void> {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: reason,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: false,
    Data: data || {},
  });

  console.log('Sending CloudFormation response:', responseBody);

  const response = await fetch(event.ResponseURL, {
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length.toString(),
    },
    body: responseBody,
  });

  if (!response.ok) {
    console.error('Failed to send CloudFormation response:', response.statusText);
  }
}

/**
 * Lambda handler
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  context: Context
): Promise<void> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties as unknown as ResourceProperties;
  const physicalResourceId =
    (event as any).PhysicalResourceId ||
    `tenant-openfga-update-${props.TenantId}`;

  try {
    if (event.RequestType === 'Delete') {
      // For deletion, we don't need to do anything
      await sendResponse(
        event,
        'SUCCESS',
        'Delete completed successfully',
        physicalResourceId
      );
      return;
    }

    // Handle Create and Update requests
    console.log(`Updating tenant ${props.TenantId} with OpenFGA endpoint`);

    await updateTenant({
      tenantId: props.TenantId,
      openFgaApiEndpoint: props.OpenFgaApiEndpoint,
      openFgaApiRegion: props.OpenFgaApiRegion,
    });

    console.log('Tenant updated successfully');

    await sendResponse(
      event,
      'SUCCESS',
      'Tenant OpenFGA endpoint updated successfully',
      physicalResourceId,
      {
        updated: true,
      }
    );
  } catch (error) {
    console.error('Error updating tenant:', error);
    await sendResponse(
      event,
      'FAILED',
      `Error: ${(error as Error).message}`,
      physicalResourceId
    );
    throw error;
  }
};
