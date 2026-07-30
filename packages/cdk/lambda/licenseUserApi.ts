/* eslint-disable i18nhelper/no-jp-string */
/**
 * User-facing license endpoints, routed in one Lambda to keep the
 * CloudFormation resource count down (the stack is near the 500-resource
 * limit):
 *   GET  /license/me                 ... own usage status (badge / detail)
 *   POST /license/transcribe/start   ... realtime transcription start gate
 *   POST /license/transcribe/report  ... cumulative-seconds report; charges
 *                                        the delta, returns remaining %
 *
 * Realtime metering (design doc ch.5 (2)B): the browser connects directly to
 * Amazon Transcribe Streaming, so the server cannot count seconds or cut the
 * connection itself. The app reports cumulative sent-audio seconds on an
 * interval and stops itself when the server says the allocation is gone.
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  GetMyLicenseResponse,
  ReportTranscribeSessionRequest,
  ReportTranscribeSessionResponse,
  StartTranscribeSessionRequest,
  StartTranscribeSessionResponse,
} from 'generative-ai-use-cases';
import {
  alertAdmin,
  checkLicense,
  getLicenseSettings,
  getLicenseStatus,
  reportRtSession,
  startRtSession,
} from './utils/license';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const ok = (body: unknown): APIGatewayProxyResult => ({
  statusCode: 200,
  headers: CORS_HEADERS,
  body: JSON.stringify(body),
});

const clientError = (
  statusCode: number,
  message: string
): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS_HEADERS,
  body: JSON.stringify({ message }),
});

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

const getMyLicense = async (userId: string): Promise<APIGatewayProxyResult> => {
  const license = await getLicenseStatus(userId);
  const response: GetMyLicenseResponse = { license };
  return ok(response);
};

const startTranscribeSession = async (
  userId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const req: StartTranscribeSessionRequest = JSON.parse(event.body!);
  if (
    !SESSION_ID_PATTERN.test(req.sessionId ?? '') ||
    (req.mode !== 'mic' && req.mode !== 'screen')
  ) {
    return clientError(400, 'Invalid request');
  }

  const settings = await getLicenseSettings();
  const check = await checkLicense(userId);
  if (!check.allowed) {
    const body: StartTranscribeSessionResponse = {
      allowed: false,
      reason: check.reason === 'model_not_allowed' ? 'error' : check.reason,
      remainingPercent: 0,
      reportIntervalSeconds: settings.rtReportIntervalSeconds,
    };
    return ok(body);
  }

  await startRtSession(userId, req.sessionId, req.mode);
  const status = await getLicenseStatus(userId);
  const body: StartTranscribeSessionResponse = {
    allowed: true,
    remainingPercent: status.remainingPercent,
    reportIntervalSeconds: settings.rtReportIntervalSeconds,
  };
  return ok(body);
};

const reportTranscribeSession = async (
  userId: string,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const req: ReportTranscribeSessionRequest = JSON.parse(event.body!);
  const cumulativeSeconds = Number(req.cumulativeSeconds);
  if (
    !SESSION_ID_PATTERN.test(req.sessionId ?? '') ||
    !Number.isFinite(cumulativeSeconds) ||
    cumulativeSeconds < 0 ||
    // Transcribe streaming sessions are capped at 4 hours; anything above
    // that bound is a client bug, not usage.
    cumulativeSeconds > 5 * 60 * 60
  ) {
    return clientError(400, 'Invalid request');
  }

  try {
    await reportRtSession(
      userId,
      req.sessionId,
      cumulativeSeconds,
      req.final === true
    );
  } catch (e) {
    // The audio has already been consumed; a charging failure must not kill
    // the user's session. Alert the admin instead (requirement 39).
    console.error('[license] failed to charge realtime transcription', e);
    await alertAdmin(
      '【GenU版GaiXer】リアルタイム文字起こしの計上に失敗しました',
      `ユーザ: ${userId}\nセッション: ${req.sessionId}\n累計秒数: ${cumulativeSeconds}\nエラー: ${e}`
    );
  }

  const status = await getLicenseStatus(userId);
  const body: ReportTranscribeSessionResponse = {
    remainingPercent: status.remainingPercent,
    stop: !status.assigned || status.remainingPercent <= 0,
  };
  return ok(body);
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const userId = event.requestContext.authorizer!.claims['cognito:username'];
    const route = `${event.httpMethod} ${event.resource}`;

    switch (route) {
      case 'GET /license/me':
        return await getMyLicense(userId);
      case 'POST /license/transcribe/start':
        return await startTranscribeSession(userId, event);
      case 'POST /license/transcribe/report':
        return await reportTranscribeSession(userId, event);
      default:
        return clientError(404, 'Not Found');
    }
  } catch (error) {
    console.log(error);
    return clientError(500, 'Internal Server Error');
  }
};
