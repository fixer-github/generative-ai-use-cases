import {
  ThrottlingException,
  ServiceQuotaExceededException,
  DependencyFailedException,
  AccessDeniedException,
} from '@aws-sdk/client-bedrock-runtime';
import { streamingChunk } from './streamingChunk';

/**
 * Handle common Bedrock API errors and yield appropriate streaming chunks
 */
export function* handleBedrockError(error: any, region?: string) {
  if (
    error instanceof ThrottlingException ||
    error instanceof ServiceQuotaExceededException
  ) {
    yield streamingChunk({
      text: 'The server is currently experiencing high access. Please try again later.',
      stopReason: 'error',
    });
  } else if (error instanceof DependencyFailedException) {
    const modelRegion = region || process.env.MODEL_REGION;
    const modelAccessURL = `https://${modelRegion}.console.aws.amazon.com/bedrock/home?region=${modelRegion}#/modelaccess`;
    yield streamingChunk({
      text: `The selected model is not enabled. Please enable the model in the [Bedrock console Model Access screen](${modelAccessURL}).`,
      stopReason: 'error',
    });
  } else if (error instanceof AccessDeniedException) {
    const modelRegion = region || process.env.MODEL_REGION;
    const modelAccessURL = `https://${modelRegion}.console.aws.amazon.com/bedrock/home?region=${modelRegion}#/modelaccess`;
    yield streamingChunk({
      text: `The selected model is not enabled. Please enable the model in the [Bedrock console Model Access screen](${modelAccessURL}).`,
      stopReason: 'error',
    });
  } else {
    console.error(error);
    yield streamingChunk({
      text:
        'An error occurred. Please report the following error to the administrator.\n' +
        error,
      stopReason: 'error',
    });
  }
}