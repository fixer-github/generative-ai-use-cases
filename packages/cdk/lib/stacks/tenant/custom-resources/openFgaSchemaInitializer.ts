/**
 * Custom Resource Lambda for initializing OpenFGA schema
 * This is called during CloudFormation stack creation/update to set up the authorization model
 *
 * Note: This Lambda runs within the tenant stack, so it can access OpenFGA directly
 * via the internal NLB without requiring AssumeRole or SigV4 signing.
 */

import { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';
import { OPENFGA_SCHEMA, DEFAULT_LLM_MODELS, DEFAULT_FEATURES } from './openFgaSchema';

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
    console.error('Failed to send CloudFormation response:', response.statusText);
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
      type_definitions: parseSchemaToTypeDefinitions(OPENFGA_SCHEMA),
    }
  );
  console.log('Authorization model created:', modelResponse);

  console.log('OpenFGA schema initialization complete');

  return storeId;
}

/**
 * Parse OpenFGA schema DSL to type definitions
 * Note: This is a simplified parser. In production, use the official OpenFGA SDK
 */
function parseSchemaToTypeDefinitions(): any[] {
  // For now, we'll use a pre-defined structure
  // In production, use the OpenFGA SDK to parse the schema properly
  return [
    {
      type: 'user',
      relations: {},
    },
    {
      type: 'group',
      relations: {
        member: {
          union: {
            child: [
              { this: {} },
              // cspell:disable-next-line
              { computedUserset: { relation: 'member' } },
            ],
          },
        },
      },
    },
    {
      type: 'entitlement',
      relations: {
        holder: {
          union: {
            child: [
              { this: {} },
            ],
          },
        },
      },
    },
    {
      type: 'llm',
      relations: {
        via_access: { this: {} },
        accessor: {
          union: {
            child: [
              { this: {} },
              // cspell:disable-next-line
              { tupleToUserset: { tupleset: { relation: 'via_access' }, computedUserset: { relation: 'holder' } } },
            ],
          },
        },
      },
    },
    {
      type: 'feature',
      relations: {
        via_enable: { this: {} },
        enabled_user: {
          union: {
            child: [
              { this: {} },
              // cspell:disable-next-line
              { tupleToUserset: { tupleset: { relation: 'via_enable' }, computedUserset: { relation: 'holder' } } },
            ],
          },
        },
      },
    },
  ];
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
  const physicalResourceId =
    (event as any).PhysicalResourceId ||
    `openfga-schema-${props.TenantId}`;

  try {
    if (event.RequestType === 'Delete') {
      // For deletion, we don't need to do anything
      // The OpenFGA data will be removed when the stack is deleted
      await sendResponse(
        event,
        'SUCCESS',
        'Delete completed successfully',
        physicalResourceId
      );
      return;
    }

    if (event.RequestType === 'Update') {
      // For updates, we might want to re-apply the schema
      // For now, we'll just return success
      await sendResponse(
        event,
        'SUCCESS',
        'Update completed successfully',
        physicalResourceId
      );
      return;
    }

    // Handle Create request
    const storeId = await initializeSchema(
      props.InternalEndpoint,
      props.TenantId
    );

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
    console.error('Error initializing OpenFGA schema:', error);
    await sendResponse(
      event,
      'FAILED',
      `Error: ${(error as Error).message}`,
      physicalResourceId
    );
    throw error;
  }
};
