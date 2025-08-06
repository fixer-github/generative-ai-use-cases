import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { env } from 'process';
import { httpGetAsync } from './utils/httpClient';
import {
  SuccessResponse,
  NotFoundResponse,
  InternalServerErrorResponse,
} from './utils/apiResponse';

type GetModelListRequestData = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
};

type GetModelListRequest = {
  object: string;
  data: GetModelListRequestData[];
};

const createSignedRequest = async (endpoint: string) => {
  const url = new URL(endpoint);
  const hostname = url.hostname;
  const pathname = url.pathname.endsWith('/')
    ? url.pathname + 'models'
    : url.pathname + '/models';

  const request = new HttpRequest({
    hostname,
    path: pathname,
    method: 'POST',
    headers: {
      host: hostname,
      'content-type': 'application/json',
    },
  });

  const credentials = defaultProvider();
  const signer = new SignatureV4({
    credentials,
    region: process.env.AWS_REGION || 'us-east-1',
    service: 'lambda',
    sha256: Sha256,
  });

  const signedRequest = await signer.sign(request);
  return signedRequest;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    console.log(event);
    const liteLlmEndpoint = env.LITELLM_ENDPOINT;

    if (!liteLlmEndpoint) {
      return NotFoundResponse('LiteLLM endpoint is not found.');
    }

    const signedRequest = await createSignedRequest(liteLlmEndpoint);

    const fullUrl = liteLlmEndpoint.endsWith('/')
      ? liteLlmEndpoint + 'models'
      : liteLlmEndpoint + '/models';

    const response = await httpGetAsync<GetModelListRequest>(
      fullUrl,
      signedRequest.headers
    );

    const modelIds = response.data.map((value) => value.id);

    return SuccessResponse({ models: modelIds });
  } catch (error) {
    console.log(error);

    return InternalServerErrorResponse('Internal Server Error');
  }
};
