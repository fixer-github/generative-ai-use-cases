import {
  PreTokenGenerationTriggerEvent,
  PreTokenGenerationTriggerHandler,
} from 'aws-lambda';

export const handler: PreTokenGenerationTriggerHandler = async (
  event: PreTokenGenerationTriggerEvent
) => {
  const tenantId = event.request.userAttributes['custom:tenant_id'] || '';

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        tenant_id1: tenantId,
        'https://aws.amazon.com/tags': JSON.stringify({
          principal_tags: {
            tenant_id: [tenantId],
          },
        }),
      },
    },
  };

  return event;
};
