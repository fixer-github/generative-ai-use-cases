/**
 * OpenFGA Authorization Schema (JSON format)
 *
 * This schema defines the authorization model for the multi-tenant application.
 * It supports user-based and group-based permissions through entitlements.
 *
 * Equivalent DSL representation:
 * type user
 * type group
 *   relations
 *     define member: [user, group]
 * type entitlement
 *   relations
 *     define holder: [user, group]
 * type llm
 *   relations
 *     define via_access: [entitlement]
 *     define accessor: [user, group] or holder from via_access
 * type feature
 *   relations
 *     define via_enable: [entitlement]
 *     define enabled_user: [user, group] or holder from via_enable
 */

export const AUTHORIZATION_MODEL_TYPE_DEFINITIONS = [
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
            { tupleToUserset: { tupleset: { relation: 'via_enable' }, computedUserset: { relation: 'holder' } } },
          ],
        },
      },
    },
  },
];

/**
 * Initial authorization tuples to set up for a new tenant
 * These can be customized based on the tenant's requirements
 */
export interface InitialAuthorizationData {
  llmModels: string[]; // List of available LLM model IDs
  features: string[]; // List of available feature names
}

/**
 * Generate write authorization tuples for OpenFGA
 */
export function generateInitialTuples(
  data: InitialAuthorizationData
): Array<{
  user: string;
  relation: string;
  object: string;
}> {
  const tuples: Array<{
    user: string;
    relation: string;
    object: string;
  }> = [];

  // No initial tuples - permissions should be granted explicitly
  // This ensures secure-by-default behavior

  return tuples;
}

/**
 * Default LLM models that should be available in the system
 */
export const DEFAULT_LLM_MODELS = [
  'anthropic.claude-3-5-sonnet-20240620-v1:0',
  'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'anthropic.claude-3-5-haiku-20241022-v1:0',
  'anthropic.claude-3-opus-20240229-v1:0',
  'anthropic.claude-3-sonnet-20240229-v1:0',
  'anthropic.claude-3-haiku-20240307-v1:0',
];

/**
 * Default features that should be available in the system
 */
export const DEFAULT_FEATURES = [
  'chat',
  'image-generation',
  'video-generation',
  'rag',
  'agent',
  'transcript',
  'summarize',
  'editorial',
  'translate',
  'pptx-generation',
];
