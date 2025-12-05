import { Handler, Context } from 'aws-lambda';
import { PredictRequest } from 'generative-ai-use-cases';
import api from './utils/api';
import { defaultModel } from './utils/models';
import {
  createOpenFgaClientFromToken,
  checkLlmAccess,
} from './utils/openFgaClient';
import { verifyToken } from './utils/auth';

declare global {
  namespace awslambda {
    function streamifyResponse(
      f: (
        event: PredictRequest,
        responseStream: NodeJS.WritableStream,
        context: Context
      ) => Promise<void>
    ): Handler;
  }
}

export const handler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    context.callbackWaitsForEmptyEventLoop = false;

    try {
      const model = event.model || defaultModel;

      // Authorization check: Verify ID token and check LLM access
      if (!event.idToken) {
        const errorMessage = JSON.stringify({
          text: 'ID token is required for authorization',
          stopReason: 'error',
        });
        responseStream.write(errorMessage);
        responseStream.end();
        return;
      }

      // Verify token and extract user ID
      const payload = await verifyToken(event.idToken);
      if (!payload) {
        const errorMessage = JSON.stringify({
          text: 'Invalid or expired ID token',
          stopReason: 'error',
        });
        responseStream.write(errorMessage);
        responseStream.end();
        return;
      }

      const userId = payload['cognito:username'];
      if (!userId) {
        const errorMessage = JSON.stringify({
          text: 'User ID not found in token',
          stopReason: 'error',
        });
        responseStream.write(errorMessage);
        responseStream.end();
        return;
      }

      // Create OpenFGA client and check authorization for the specific LLM model
      const openFgaClient = await createOpenFgaClientFromToken(event.idToken);
      const hasAccess = await checkLlmAccess(
        openFgaClient,
        userId,
        model.modelId
      );

      if (!hasAccess) {
        console.warn(
          `User ${userId} does not have access to model ${model.modelId}`
        );
        const errorMessage = JSON.stringify({
          text: `You do not have permission to use the model: ${model.modelId}`,
          stopReason: 'error',
        });
        responseStream.write(errorMessage);
        responseStream.end();
        return;
      }

      // If authorized, proceed with streaming
      for await (const token of api[model.type].invokeStream?.(
        model,
        event.messages,
        event.id,
        event.idToken
      ) ?? []) {
        responseStream.write(token);
      }
      responseStream.end();
    } catch (error) {
      console.error('PredictStream error:', error);
      const errorMessage = JSON.stringify({
        text: 'Internal Server Error',
        stopReason: 'error',
      });
      responseStream.write(errorMessage);
      responseStream.end();
    }
  }
);
