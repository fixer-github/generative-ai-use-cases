/**
 * SpiceDB Schema Migration Lambda
 * SpiceDBスキーマ移行Lambda
 *
 * Applies the authorization schema to SpiceDB cluster.
 * Should be run as a one-time migration or during stack updates.
 */

import { v1 } from '@authzed/authzed-node';
import { readFileSync } from 'fs';
import { join } from 'path';

const { SPICEDB_ENDPOINT, SPICEDB_TOKEN } = process.env;

// SpiceDB client
let spiceDBClient: v1.ZedClient | null = null;

function getSpiceDBClient(): v1.ZedClient {
  if (!spiceDBClient) {
    spiceDBClient = v1.NewClient(
      SPICEDB_ENDPOINT!,
      v1.ClientSecurity.newInsecureBearerToken(SPICEDB_TOKEN!)
    );
  }
  return spiceDBClient;
}

// Authorization schema
const AUTHORIZATION_SCHEMA = `
/**
 * SpiceDB Authorization Schema for GenAI Multi-Tenant Application
 */

definition user {}

definition tenant {
    relation member: user
    relation admin: user
    relation subscribed_plan: plan

    permission view = member + admin
    permission manage = admin
}

definition plan {
    relation subscriber: tenant
    relation allowed_usecase: usecase
    relation allowed_model: model

    permission use = subscriber
}

definition conversation {
    relation tenant: tenant
    relation owner: user
    relation viewer: user

    permission view = viewer + owner + tenant->member
    permission edit = owner
    permission delete = owner + tenant->admin
}

definition document {
    relation tenant: tenant
    relation owner: user
    relation uploader: user
    relation viewer: user

    permission view = viewer + owner + tenant->member
    permission upload = tenant->member
    permission delete = owner + tenant->admin
}

definition usecase {
    relation allowed_by_plan: plan

    permission execute = allowed_by_plan->subscriber->member
}

definition model {
    relation allowed_by_plan: plan

    permission execute = allowed_by_plan->subscriber->member
}

caveat quota_available(current_usage int, quota_limit int) {
    current_usage < quota_limit
}

definition model_with_quota {
    relation allowed_by_plan: plan
    relation user: user

    permission execute = (user & allowed_by_plan->subscriber->member) if quota_available
}

definition admin_operation {
    relation allowed_admin: user

    permission execute = allowed_admin
}
`;

// Handler
export async function handler(event: any): Promise<any> {
  console.log('Schema migration event:', JSON.stringify(event, null, 2));

  try {
    const client = getSpiceDBClient();

    // Apply schema
    console.log('Applying SpiceDB schema...');

    const writeSchemaRequest = v1.WriteSchemaRequest.create({
      schema: AUTHORIZATION_SCHEMA,
    });

    const response = await client.writeSchema(writeSchemaRequest);

    console.log('Schema applied successfully');
    console.log('Written at:', response.writtenAt);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Schema applied successfully',
        writtenAt: response.writtenAt,
      }),
    };
  } catch (error) {
    console.error('Schema migration failed:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Schema migration failed',
        error: String(error),
      }),
    };
  }
}

/**
 * Initialize default plans in SpiceDB
 * This creates the basic plan relationships
 */
export async function initializeDefaultPlans(): Promise<void> {
  const client = getSpiceDBClient();

  console.log('Initializing default plans...');

  // Define default plans and their permissions
  const plans = [
    {
      planId: 'free',
      usecases: ['chat'],
      models: ['claude-3-haiku'],
    },
    {
      planId: 'pro',
      usecases: ['chat', 'rag', 'translation', 'text_generation', 'image_generation'],
      models: ['claude-3-haiku', 'claude-3-sonnet', 'gpt-4'],
    },
    {
      planId: 'enterprise',
      usecases: ['chat', 'rag', 'translation', 'text_generation', 'image_generation', 'video_generation', 'audio_chat'],
      models: ['claude-3-haiku', 'claude-3-sonnet', 'claude-3-opus', 'gpt-4', 'gpt-4-turbo'],
    },
  ];

  // Create relationships for each plan
  const updates: v1.RelationshipUpdate[] = [];

  for (const plan of plans) {
    // Plan allows usecases
    for (const usecase of plan.usecases) {
      updates.push(
        v1.RelationshipUpdate.create({
          operation: v1.RelationshipUpdate_Operation.TOUCH,
          relationship: v1.Relationship.create({
            resource: v1.ObjectReference.create({
              objectType: 'plan',
              objectId: plan.planId,
            }),
            relation: 'allowed_usecase',
            subject: v1.SubjectReference.create({
              object: v1.ObjectReference.create({
                objectType: 'usecase',
                objectId: usecase,
              }),
            }),
          }),
        })
      );
    }

    // Plan allows models
    for (const model of plan.models) {
      updates.push(
        v1.RelationshipUpdate.create({
          operation: v1.RelationshipUpdate_Operation.TOUCH,
          relationship: v1.Relationship.create({
            resource: v1.ObjectReference.create({
              objectType: 'plan',
              objectId: plan.planId,
            }),
            relation: 'allowed_model',
            subject: v1.SubjectReference.create({
              object: v1.ObjectReference.create({
                objectType: 'model',
                objectId: model,
              }),
            }),
          }),
        })
      );

      // Also for model_with_quota
      updates.push(
        v1.RelationshipUpdate.create({
          operation: v1.RelationshipUpdate_Operation.TOUCH,
          relationship: v1.Relationship.create({
            resource: v1.ObjectReference.create({
              objectType: 'model_with_quota',
              objectId: model,
            }),
            relation: 'allowed_by_plan',
            subject: v1.SubjectReference.create({
              object: v1.ObjectReference.create({
                objectType: 'plan',
                objectId: plan.planId,
              }),
            }),
          }),
        })
      );
    }
  }

  // Write all relationships
  const writeRequest = v1.WriteRelationshipsRequest.create({
    updates,
  });

  await client.writeRelationships(writeRequest);

  console.log('Default plans initialized successfully');
}

/**
 * Helper: Create tenant namespace and assign plan
 */
export async function createTenantWithPlan(
  tenantId: string,
  planId: string = 'free'
): Promise<void> {
  const client = getSpiceDBClient();

  console.log(`Creating tenant ${tenantId} with plan ${planId}...`);

  const updates: v1.RelationshipUpdate[] = [
    // Tenant subscribes to plan
    v1.RelationshipUpdate.create({
      operation: v1.RelationshipUpdate_Operation.TOUCH,
      relationship: v1.Relationship.create({
        resource: v1.ObjectReference.create({
          objectType: 'tenant',
          objectId: tenantId,
        }),
        relation: 'subscribed_plan',
        subject: v1.SubjectReference.create({
          object: v1.ObjectReference.create({
            objectType: 'plan',
            objectId: planId,
          }),
        }),
      }),
    }),
    // Plan has this tenant as subscriber
    v1.RelationshipUpdate.create({
      operation: v1.RelationshipUpdate_Operation.TOUCH,
      relationship: v1.Relationship.create({
        resource: v1.ObjectReference.create({
          objectType: 'plan',
          objectId: planId,
        }),
        relation: 'subscriber',
        subject: v1.SubjectReference.create({
          object: v1.ObjectReference.create({
            objectType: 'tenant',
            objectId: tenantId,
          }),
        }),
      }),
    }),
  ];

  const writeRequest = v1.WriteRelationshipsRequest.create({
    updates,
  });

  await client.writeRelationships(writeRequest);

  console.log(`Tenant ${tenantId} created successfully`);
}
