import {
  PreTokenGenerationTriggerEvent,
  PreTokenGenerationTriggerHandler,
} from 'aws-lambda';

export const handler: PreTokenGenerationTriggerHandler = async (
  event: PreTokenGenerationTriggerEvent
) => {
  const tenantId = event.request.userAttributes['custom:tenant_id'];

  event.response = {
    claimsOverrideDetails: {
      claimsToAddOrOverride: {
        tenant_id: tenantId || '',
      },
    },
  };

  return event;
};
