/**
 * Custom Resource Lambda for initializing OpenFGA schema
 * This is called during CloudFormation stack creation/update to set up the authorization model
 *
 * Note: This Lambda runs within the tenant stack, so it can access OpenFGA directly
 * via the internal NLB without requiring AssumeRole or SigV4 signing.
 */

import { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import { AUTHORIZATION_MODEL_TYPE_DEFINITIONS } from './openFgaSchema';

interface ResourceProperties {
  InternalEndpoint: string;
  TenantId: string;
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

  const url = new URL(event.ResponseURL);
  const response = await fetch(event.ResponseURL, {
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': responseBody.length.toString(),
    },
    body: responseBody,
  });

  if (!response.ok) {
    console.error(
      'Failed to send CloudFormation response:',
      response.statusText
    );
  }
}

/**
 * Make a request to OpenFGA API (internal endpoint)
 */
async function makeOpenFgaRequest(
  internalEndpoint: string,
  method: string,
  path: string,
  body?: any
): Promise<any> {
  const url = `${internalEndpoint}${path}`;

  console.log(`Making OpenFGA request: ${method} ${url}`);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `OpenFGA API request failed: ${response.status} ${response.statusText} - ${errorText}`
    );
  }

  return await response.json();
}

/**
 * Initialize OpenFGA schema
 */
async function initializeSchema(
  internalEndpoint: string,
  tenantId: string
): Promise<string> {
  console.log(`Initializing OpenFGA schema for tenant: ${tenantId}`);

  // Step 1: Create store
  console.log('Creating OpenFGA store...');
  const createStoreResponse = await makeOpenFgaRequest(
    internalEndpoint,
    'POST',
    '/stores',
    {
      name: `tenant-${tenantId}`,
    }
  );
  console.log('Store created:', createStoreResponse);

  const storeId = createStoreResponse.id;
  if (!storeId) {
    throw new Error('Store creation did not return a store ID');
  }

  console.log(`Store ID: ${storeId}`);

  // Step 2: Write authorization model
  console.log('Writing authorization model...');
  const modelResponse = await makeOpenFgaRequest(
    internalEndpoint,
    'POST',
    `/stores/${storeId}/authorization-models`,
    {
      schema_version: '1.1',
      type_definitions: AUTHORIZATION_MODEL_TYPE_DEFINITIONS,
    }
  );
  console.log('Authorization model created:', modelResponse);

  console.log('OpenFGA schema initialization complete');

  return storeId;
}

/**
 * Update OpenFGA authorization model
 */
async function updateAuthorizationModel(
  internalEndpoint: string,
  storeId: string
): Promise<void> {
  console.log(`Updating authorization model for store: ${storeId}`);

  // OpenFGAでは新しいモデルをPOSTすることで更新
  // 既存のtuples（権限データ）は保持され、新しいモデルが最新として使われる
  const modelResponse = await makeOpenFgaRequest(
    internalEndpoint,
    'POST',
    `/stores/${storeId}/authorization-models`,
    {
      schema_version: '1.1',
      type_definitions: AUTHORIZATION_MODEL_TYPE_DEFINITIONS,
    }
  );
  console.log('Authorization model updated:', modelResponse);
}

/**
 * Lambda handler
 */
export const handler = async (
  event: CloudFormationCustomResourceEvent,
  _context: Context
): Promise<void> => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const props = event.ResourceProperties as unknown as ResourceProperties;

  try {
    if (event.RequestType === 'Delete') {
      // For deletion, we don't need to do anything
      // The OpenFGA data will be removed when the stack is deleted
      await sendResponse(
        event,
        'SUCCESS',
        'Delete completed successfully',
        event.PhysicalResourceId
      );
      return;
    }

    if (event.RequestType === 'Update') {
      const physicalResourceId = event.PhysicalResourceId;
      const storeId = physicalResourceId.replace('openfga-store-', '');

      console.log(`Updating authorization model for store: ${storeId}`);

      // スキーマ定義の変更を反映
      await updateAuthorizationModel(props.InternalEndpoint, storeId);

      await sendResponse(
        event,
        'SUCCESS',
        'Authorization model updated successfully',
        physicalResourceId,
        {
          StoreId: storeId,
        }
      );
      return;
    }

    // Handle Create request
    const storeId = await initializeSchema(
      props.InternalEndpoint,
      props.TenantId
    );

    const physicalResourceId = `openfga-store-${storeId}`;

    await sendResponse(
      event,
      'SUCCESS',
      'OpenFGA schema initialized successfully',
      physicalResourceId,
      {
        StoreId: storeId,
      }
    );
  } catch (error) {
    console.error('Error in OpenFGA schema handler:', error);

    // エラー時のPhysicalResourceId: Update/Deleteなら既存のID、Createなら新規ID
    const physicalResourceId =
      'PhysicalResourceId' in event
        ? event.PhysicalResourceId
        : `openfga-schema-${props.TenantId}-error`;

    await sendResponse(
      event,
      'FAILED',
      `Error: ${(error as Error).message}`,
      physicalResourceId
    );
    throw error;
  }
};
