/* eslint-disable i18nhelper/no-jp-string */
/**
 * License core (cash/consumption-based usage limit)
 *
 * Single-table layout on LICENSE_TABLE_NAME:
 *   pk = 'plans'          sk = 'plan#<planId>'            ... plan definition
 *   pk = 'user#<userId>'  sk = 'assignment'               ... plan assignment (+ pending change)
 *   pk = 'user#<userId>'  sk = 'usage#<YYYY-MM>'          ... monthly ledger (JPY, atomic ADD)
 *   pk = 'user#<userId>'  sk = 'charged#transcribe#<job>' ... batch transcription charge marker
 *   pk = 'user#<userId>'  sk = 'transcribe-rt#<session>'  ... realtime transcription session
 *   pk = 'config'         sk = 'price#<modelKey>'         ... model unit prices (USD, JP-region)
 *   pk = 'config'         sk = 'fxRate'                   ... USD/JPY rate (daily)
 *   pk = 'config'         sk = 'settings'                 ... thresholds and unit prices for Transcribe
 *
 * Enforcement is two-phase (design doc ch.2): checkLicense() gates before the
 * AI runs (fail-closed), charge*() records the actual cost afterwards.
 * Amounts are stored as fractional JPY; only percentages leave this module's
 * status accessors (requirement 23).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  LicensePlan,
  LicenseStatus,
  LicenseUsageCategory,
  LicenseBreakdownEntry,
} from 'generative-ai-use-cases';
import { isSendGridConfigured, sendMail } from './sendgrid';

const LICENSE_TABLE_NAME = process.env.LICENSE_TABLE_NAME ?? '';

const dynamoDbDocument = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const PLANS_PK = 'plans';
const CONFIG_PK = 'config';
const userPk = (userId: string) => `user#${userId}`;
// Ledger items expire ~13 months after creation (kept for reference, then GC'd)
const USAGE_TTL_SECONDS = 13 * 31 * 24 * 60 * 60;
// Realtime transcription sessions are short-lived; keep for 2 days
const RT_SESSION_TTL_SECONDS = 2 * 24 * 60 * 60;

export const LICENSE_ENABLED = LICENSE_TABLE_NAME.length > 0;

// ---------------------------------------------------------------------------
// Time helpers (all month boundaries are Asia/Tokyo, requirement 33)
// ---------------------------------------------------------------------------

const jstNow = (): Date =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

export const currentMonthKey = (): string => {
  const jst = jstNow();
  return `${jst.getFullYear()}-${`${jst.getMonth() + 1}`.padStart(2, '0')}`;
};

export const nextMonthKey = (): string => {
  const jst = jstNow();
  const next = new Date(jst.getFullYear(), jst.getMonth() + 1, 1);
  return `${next.getFullYear()}-${`${next.getMonth() + 1}`.padStart(2, '0')}`;
};

// Next reset date (1st of next month, JST) as YYYY-MM-DD
export const nextResetDate = (): string => {
  return `${nextMonthKey()}-01`;
};

// ---------------------------------------------------------------------------
// Config: settings / fx rate / model prices (cached per warm container)
// ---------------------------------------------------------------------------

export type LicenseSettings = {
  warnThresholdPercent: number;
  criticalThresholdPercent: number;
  // Transcribe unit prices are different per mode (design doc ch.4)
  transcribeBatchUsdPerMinute: number;
  transcribeStreamingUsdPerMinute: number;
  minBillableSeconds: number;
  rtReportIntervalSeconds: number;
  adminAlertEmail: string;
};

export const DEFAULT_LICENSE_SETTINGS: LicenseSettings = {
  warnThresholdPercent: 30,
  criticalThresholdPercent: 10,
  transcribeBatchUsdPerMinute: 0.006,
  transcribeStreamingUsdPerMinute: 0.01,
  minBillableSeconds: 15,
  rtReportIntervalSeconds: 15,
  adminAlertEmail: '',
};

export type ModelPrice = {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  cacheReadUsdPerMTok: number;
  cacheWriteUsdPerMTok: number;
};

export type FxRate = {
  rateJpyPerUsd: number;
  updatedDate: string;
  source: string;
  previousRateJpyPerUsd?: number;
};

const CONFIG_CACHE_TTL_MS = 60 * 1000;
const configCache = new Map<string, { value: unknown; expiresAt: number }>();

const getConfigItem = async <T>(sk: string): Promise<T | undefined> => {
  const cached = configCache.get(sk);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T | undefined;
  }
  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: LICENSE_TABLE_NAME,
      Key: { pk: CONFIG_PK, sk },
    })
  );
  const value = res.Item as T | undefined;
  configCache.set(sk, { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
  return value;
};

export const getLicenseSettings = async (): Promise<LicenseSettings> => {
  const stored = await getConfigItem<Partial<LicenseSettings>>('settings');
  return { ...DEFAULT_LICENSE_SETTINGS, ...(stored ?? {}) };
};

export const getFxRate = async (): Promise<FxRate | undefined> => {
  return await getConfigItem<FxRate>('fxRate');
};

// Normalize a Bedrock model ID to the price table key.
// 'jp.anthropic.claude-sonnet-4-5-20250929-v1:0' -> 'claude-sonnet-4-5'
// Falls back to the full model ID when the pattern does not match.
export const normalizeModelKey = (modelId: string): string => {
  const idx = modelId.indexOf('anthropic.');
  const base = idx >= 0 ? modelId.slice(idx + 'anthropic.'.length) : modelId;
  const m = base.match(/^(.*?)-\d{8}-v\d+(?::\d+)?$/);
  return m ? m[1] : modelId;
};

export const getModelPrice = async (
  modelId: string
): Promise<ModelPrice | undefined> => {
  const byKey = await getConfigItem<ModelPrice>(
    `price#${normalizeModelKey(modelId)}`
  );
  if (byKey) return byKey;
  return await getConfigItem<ModelPrice>(`price#${modelId}`);
};

// ---------------------------------------------------------------------------
// Cost conversion (design doc ch.4)
// ---------------------------------------------------------------------------

export type LlmUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
};

export const calcLlmCostYen = (
  usage: LlmUsage,
  price: ModelPrice,
  rateJpyPerUsd: number
): number => {
  const usd =
    ((usage.inputTokens ?? 0) * price.inputUsdPerMTok +
      (usage.outputTokens ?? 0) * price.outputUsdPerMTok +
      (usage.cacheReadInputTokens ?? 0) * price.cacheReadUsdPerMTok +
      (usage.cacheWriteInputTokens ?? 0) * price.cacheWriteUsdPerMTok) /
    1_000_000;
  return usd * rateJpyPerUsd;
};

export const calcTranscribeCostYen = (
  seconds: number,
  usdPerMinute: number,
  rateJpyPerUsd: number
): number => {
  return (seconds / 60) * usdPerMinute * rateJpyPerUsd;
};

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export const listPlans = async (): Promise<LicensePlan[]> => {
  const res = await dynamoDbDocument.send(
    new QueryCommand({
      TableName: LICENSE_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': PLANS_PK, ':prefix': 'plan#' },
    })
  );
  return (res.Items ?? []).map(itemToPlan);
};

export const getPlan = async (
  planId: string
): Promise<LicensePlan | undefined> => {
  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: LICENSE_TABLE_NAME,
      Key: { pk: PLANS_PK, sk: `plan#${planId}` },
    })
  );
  return res.Item ? itemToPlan(res.Item) : undefined;
};

export const putPlan = async (plan: LicensePlan): Promise<void> => {
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: LICENSE_TABLE_NAME,
      Item: {
        pk: PLANS_PK,
        sk: `plan#${plan.planId}`,
        name: plan.name,
        monthlyFeeYen: plan.monthlyFeeYen,
        allocationYen: plan.allocationYen,
        allowedModelIds: plan.allowedModelIds,
        enabled: plan.enabled,
        createdDate: plan.createdDate,
        updatedDate: plan.updatedDate,
      },
    })
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const itemToPlan = (item: Record<string, any>): LicensePlan => ({
  planId: (item.sk as string).replace(/^plan#/, ''),
  name: item.name ?? '',
  monthlyFeeYen: item.monthlyFeeYen ?? 0,
  allocationYen: item.allocationYen ?? 0,
  allowedModelIds: item.allowedModelIds ?? [],
  enabled: item.enabled ?? false,
  createdDate: item.createdDate ?? '',
  updatedDate: item.updatedDate ?? '',
});

// ---------------------------------------------------------------------------
// Assignment (with pending plan change applied lazily on first read of a new
// month — design doc ch.8)
// ---------------------------------------------------------------------------

export type Assignment = {
  planId: string | null;
  pendingPlanId?: string | null;
  pendingFromMonth?: string;
  assignedBy?: string;
  updatedDate?: string;
};

const getRawAssignment = async (
  userId: string
): Promise<Assignment | undefined> => {
  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: LICENSE_TABLE_NAME,
      Key: { pk: userPk(userId), sk: 'assignment' },
    })
  );
  return res.Item as Assignment | undefined;
};

// Returns the effective assignment, applying a pending plan change once the
// month it is scheduled for has been reached.
export const getAssignment = async (
  userId: string
): Promise<Assignment | undefined> => {
  const raw = await getRawAssignment(userId);
  if (!raw) return undefined;
  if (
    raw.pendingPlanId !== undefined &&
    raw.pendingPlanId !== null &&
    raw.pendingFromMonth &&
    raw.pendingFromMonth <= currentMonthKey()
  ) {
    try {
      await dynamoDbDocument.send(
        new UpdateCommand({
          TableName: LICENSE_TABLE_NAME,
          Key: { pk: userPk(userId), sk: 'assignment' },
          UpdateExpression:
            'SET planId = :newPlan, updatedDate = :now REMOVE pendingPlanId, pendingFromMonth',
          ConditionExpression: 'pendingPlanId = :expected',
          ExpressionAttributeValues: {
            ':newPlan': raw.pendingPlanId,
            ':expected': raw.pendingPlanId,
            ':now': new Date().toISOString(),
          },
        })
      );
    } catch (e) {
      // Lost a race against another applier — re-read the settled state
      if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') {
        throw e;
      }
      return await getRawAssignment(userId);
    }
    return { ...raw, planId: raw.pendingPlanId, pendingPlanId: undefined };
  }
  return raw;
};

// Assign / change / unassign a plan (requirement 13: changes between plans
// take effect on the 1st of next month; first assignment and unassignment are
// immediate).
export const assignPlan = async (
  userId: string,
  planId: string | null,
  assignedBy: string
): Promise<'immediate' | 'nextMonth'> => {
  const current = await getAssignment(userId);
  const now = new Date().toISOString();

  if (planId !== null && current?.planId && current.planId !== planId) {
    // Change between plans -> reserve for next month
    await dynamoDbDocument.send(
      new PutCommand({
        TableName: LICENSE_TABLE_NAME,
        Item: {
          pk: userPk(userId),
          sk: 'assignment',
          planId: current.planId,
          pendingPlanId: planId,
          pendingFromMonth: nextMonthKey(),
          assignedBy,
          updatedDate: now,
        },
      })
    );
    return 'nextMonth';
  }

  // First assignment, re-assignment of the same plan, or unassignment
  await dynamoDbDocument.send(
    new PutCommand({
      TableName: LICENSE_TABLE_NAME,
      Item: {
        pk: userPk(userId),
        sk: 'assignment',
        planId,
        assignedBy,
        updatedDate: now,
      },
    })
  );
  return 'immediate';
};

// ---------------------------------------------------------------------------
// Monthly ledger
// ---------------------------------------------------------------------------

const CATEGORIES: LicenseUsageCategory[] = [
  'chat',
  'generation',
  'summarize',
  'translate',
  'transcribe',
  'agent',
];

type UsageItem = {
  consumedYen?: number;
  allocationYen?: number;
} & { [K in `spent#${LicenseUsageCategory}`]?: number };

const getUsage = async (
  userId: string,
  monthKey: string
): Promise<UsageItem | undefined> => {
  const res = await dynamoDbDocument.send(
    new GetCommand({
      TableName: LICENSE_TABLE_NAME,
      Key: { pk: userPk(userId), sk: `usage#${monthKey}` },
    })
  );
  return res.Item as UsageItem | undefined;
};

// Builds the atomic ledger update for a charge. Used standalone and inside
// DynamoDB transactions (realtime transcription / batch charge markers).
const buildLedgerUpdate = (
  userId: string,
  amountYen: number,
  category: LicenseUsageCategory,
  allocationYen: number
) => ({
  TableName: LICENSE_TABLE_NAME,
  Key: { pk: userPk(userId), sk: `usage#${currentMonthKey()}` },
  UpdateExpression:
    'ADD consumedYen :amount, #cat :amount ' +
    'SET allocationYen = if_not_exists(allocationYen, :allocation), ' +
    '#ttl = if_not_exists(#ttl, :ttl), updatedDate = :now',
  ExpressionAttributeNames: {
    '#cat': `spent#${category}`,
    '#ttl': 'ttl',
  },
  ExpressionAttributeValues: {
    ':amount': amountYen,
    ':allocation': allocationYen,
    ':ttl': Math.floor(Date.now() / 1000) + USAGE_TTL_SECONDS,
    ':now': new Date().toISOString(),
  },
});

const resolveAllocationYen = async (userId: string): Promise<number> => {
  const assignment = await getAssignment(userId);
  if (!assignment?.planId) return 0;
  const plan = await getPlan(assignment.planId);
  return plan?.allocationYen ?? 0;
};

// Record a charge against the user's monthly ledger. Over-consumption is
// allowed (negative remainder, requirement 37); subsequent sends are blocked
// by checkLicense(). Throws on persistent failure — use chargeSafely()
// wrappers on response paths that must not fail the user-visible response.
export const chargeUsage = async (
  userId: string,
  amountYen: number,
  category: LicenseUsageCategory
): Promise<void> => {
  if (!(amountYen > 0)) return;
  const allocationYen = await resolveAllocationYen(userId);
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      await dynamoDbDocument.send(
        new UpdateCommand(
          buildLedgerUpdate(userId, amountYen, category, allocationYen)
        )
      );
      return;
    } catch (e) {
      if (attempt >= maxAttempts) throw e;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
};

// Alert the administrator (requirement 39). Failures here are logged only.
export const alertAdmin = async (
  subject: string,
  body: string
): Promise<void> => {
  try {
    const settings = await getLicenseSettings();
    if (!settings.adminAlertEmail || !isSendGridConfigured()) {
      console.error(
        `[license] admin alert (mail not configured): ${subject}\n${body}`
      );
      return;
    }
    await sendMail(settings.adminAlertEmail, subject, body);
  } catch (e) {
    console.error('[license] failed to send admin alert', e);
  }
};

// Charge an LLM usage (token breakdown -> JPY, requirement 14-17).
export const chargeLlmUsage = async (
  userId: string,
  modelId: string,
  usage: LlmUsage,
  category: LicenseUsageCategory
): Promise<void> => {
  const price = await getModelPrice(modelId);
  if (!price) {
    throw new Error(`[license] no unit price registered for model ${modelId}`);
  }
  const fx = await getFxRate();
  if (!fx) {
    throw new Error('[license] fx rate is not available');
  }
  const yen = calcLlmCostYen(usage, price, fx.rateJpyPerUsd);
  await chargeUsage(userId, yen, category);
};

// Same as chargeLlmUsage but never throws: the AI response has already been
// returned to the user and must not be rolled back (requirement 39).
export const chargeLlmUsageSafely = async (
  userId: string,
  modelId: string,
  usage: LlmUsage,
  category: LicenseUsageCategory
): Promise<void> => {
  try {
    await chargeLlmUsage(userId, modelId, usage, category);
  } catch (e) {
    console.error('[license] failed to charge LLM usage', e);
    await alertAdmin(
      '【GenU版GaiXer】ライセンス消費の計上に失敗しました',
      `ユーザ: ${userId}\nモデル: ${modelId}\n使用量: ${JSON.stringify(usage)}\n区分: ${category}\nエラー: ${e}\n\nDynamoDBのライセンステーブルを確認し、必要に応じて手動で計上してください。`
    );
  }
};

// ---------------------------------------------------------------------------
// Status (percentages only — requirement 23)
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;

export const getLicenseStatus = async (
  userId: string
): Promise<LicenseStatus> => {
  const settings = await getLicenseSettings();
  const base: LicenseStatus = {
    assigned: false,
    planId: null,
    planName: null,
    pendingPlanId: null,
    pendingPlanName: null,
    allowedModelIds: [],
    remainingPercent: 0,
    breakdown: [],
    resetDate: nextResetDate(),
    warnThresholdPercent: settings.warnThresholdPercent,
    criticalThresholdPercent: settings.criticalThresholdPercent,
    rtReportIntervalSeconds: settings.rtReportIntervalSeconds,
  };

  const assignment = await getAssignment(userId);
  if (!assignment?.planId) return base;

  const plan = await getPlan(assignment.planId);
  const pendingPlan = assignment.pendingPlanId
    ? await getPlan(assignment.pendingPlanId)
    : undefined;

  if (!plan || !plan.enabled) {
    // Disabled/deleted plan -> unusable (requirement 12)
    return {
      ...base,
      planId: assignment.planId,
      planName: plan?.name ?? null,
      pendingPlanId: assignment.pendingPlanId ?? null,
      pendingPlanName: pendingPlan?.name ?? null,
    };
  }

  const usage = await getUsage(userId, currentMonthKey());
  // Allocation is snapshotted into the ledger at first charge; a user with no
  // usage this month is shown as 100% remaining (design doc ch.7, v4).
  const allocationYen = usage?.allocationYen ?? plan.allocationYen;
  const consumedYen = usage?.consumedYen ?? 0;
  const remaining =
    allocationYen > 0 ? (1 - consumedYen / allocationYen) * 100 : 0;

  const breakdown: LicenseBreakdownEntry[] = CATEGORIES.map((category) => {
    const spent = usage?.[`spent#${category}`] ?? 0;
    return {
      category,
      percent: allocationYen > 0 ? round1((spent / allocationYen) * 100) : 0,
    };
  }).filter((entry) => entry.percent > 0);

  return {
    ...base,
    assigned: true,
    planId: assignment.planId,
    planName: plan.name,
    pendingPlanId: assignment.pendingPlanId ?? null,
    pendingPlanName: pendingPlan?.name ?? null,
    allowedModelIds: plan.allowedModelIds,
    // Negative balances are shown as 0% (design doc ch.7, v4)
    remainingPercent: Math.max(0, round1(remaining)),
    breakdown,
  };
};

// ---------------------------------------------------------------------------
// Enforcement (entry gate; fail-closed by construction — requirement 38)
// ---------------------------------------------------------------------------

export type LicenseCheckResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'unassigned' | 'exhausted' | 'model_not_allowed' | 'error';
    };

export const checkLicense = async (
  userId: string,
  opts?: { modelId?: string }
): Promise<LicenseCheckResult> => {
  try {
    const assignment = await getAssignment(userId);
    if (!assignment?.planId) {
      return { allowed: false, reason: 'unassigned' };
    }
    const plan = await getPlan(assignment.planId);
    if (!plan || !plan.enabled) {
      return { allowed: false, reason: 'unassigned' };
    }
    if (opts?.modelId && !plan.allowedModelIds.includes(opts.modelId)) {
      return { allowed: false, reason: 'model_not_allowed' };
    }
    const usage = await getUsage(userId, currentMonthKey());
    const allocationYen = usage?.allocationYen ?? plan.allocationYen;
    const consumedYen = usage?.consumedYen ?? 0;
    if (allocationYen <= 0 || consumedYen >= allocationYen) {
      return { allowed: false, reason: 'exhausted' };
    }
    return { allowed: true };
  } catch (e) {
    // Fail-closed: if the check itself cannot run, do not let the request
    // through (requirement 38). The pre-existing count-based prototype was
    // fail-open here; this is an intentional reversal.
    console.error('[license] check failed (fail-closed)', e);
    return { allowed: false, reason: 'error' };
  }
};

// User-facing message for a blocked request.
export const blockMessage = (
  reason: 'unassigned' | 'exhausted' | 'model_not_allowed' | 'error'
): string => {
  switch (reason) {
    case 'unassigned':
      return 'ライセンスプランが割り当てられていないため、この機能は利用できません。管理者にプランの割当を依頼してください。';
    case 'exhausted':
      return `今月の利用可能量を使い切りました。${nextResetDate().replace(/-0?(\d+)-0?(\d+)$/, '年$1月$2日')}の0時に全量回復します。過去の会話の閲覧・コピーは引き続き可能です。`;
    case 'model_not_allowed':
      return '選択中のモデルは現在のプランではご利用いただけません。別のモデルを選択してください。';
    case 'error':
      return 'ライセンス情報の確認に失敗したため、送信を停止しました。時間をおいて再度お試しください。解消しない場合は管理者にお問い合わせください。';
  }
};

// ---------------------------------------------------------------------------
// Usecase mapping (design review: entry point list confirmed 2026-07-30)
// ---------------------------------------------------------------------------

// RAG paths are excluded from metering (requirement 2). Everything else that
// reaches predictStream / predict with a Bedrock text model is metered.
export const isLicenseExemptUsecase = (id?: string): boolean => {
  if (!id) return false;
  return id === '/rag' || id.startsWith('/rag/') || id.startsWith('/rag-');
};

export const usecaseToCategory = (id?: string): LicenseUsageCategory => {
  if (!id) return 'chat';
  const match = (prefix: string) =>
    id === prefix || id.startsWith(`${prefix}/`);
  if (match('/summarize')) return 'summarize';
  if (match('/translate')) return 'translate';
  if (id.startsWith('meeting-minutes')) return 'generation';
  if (
    match('/generate') ||
    match('/writer') ||
    match('/diagram') ||
    match('/web-content') ||
    match('/video')
  ) {
    return 'generation';
  }
  return 'chat';
};

// ---------------------------------------------------------------------------
// Batch transcription (charged once on completion; design doc ch.5 (2)A)
// ---------------------------------------------------------------------------

export const chargeTranscribeJobOnce = async (
  userId: string,
  jobName: string,
  seconds: number
): Promise<void> => {
  const settings = await getLicenseSettings();
  const fx = await getFxRate();
  if (!fx) throw new Error('[license] fx rate is not available');
  const billableSeconds = Math.max(seconds, settings.minBillableSeconds);
  const yen = calcTranscribeCostYen(
    billableSeconds,
    settings.transcribeBatchUsdPerMinute,
    fx.rateJpyPerUsd
  );
  const allocationYen = await resolveAllocationYen(userId);
  try {
    await dynamoDbDocument.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: LICENSE_TABLE_NAME,
              Item: {
                pk: userPk(userId),
                sk: `charged#transcribe#${jobName}`,
                chargedSeconds: billableSeconds,
                chargedYen: yen,
                createdDate: new Date().toISOString(),
                ttl: Math.floor(Date.now() / 1000) + USAGE_TTL_SECONDS,
              },
              ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          {
            Update: buildLedgerUpdate(userId, yen, 'transcribe', allocationYen),
          },
        ],
      })
    );
  } catch (e) {
    // Charge marker already present -> polled twice, already charged
    const cancelled = (e as { CancellationReasons?: { Code?: string }[] })
      .CancellationReasons;
    if (cancelled?.some((r) => r.Code === 'ConditionalCheckFailed')) {
      return;
    }
    throw e;
  }
};

export const chargeTranscribeJobOnceSafely = async (
  userId: string,
  jobName: string,
  seconds: number
): Promise<void> => {
  try {
    await chargeTranscribeJobOnce(userId, jobName, seconds);
  } catch (e) {
    console.error('[license] failed to charge transcription job', e);
    await alertAdmin(
      '【GenU版GaiXer】文字起こし利用の計上に失敗しました',
      `ユーザ: ${userId}\nジョブ: ${jobName}\n秒数: ${seconds}\nエラー: ${e}\n\nDynamoDBのライセンステーブルを確認し、必要に応じて手動で計上してください。`
    );
  }
};

// ---------------------------------------------------------------------------
// Realtime transcription metering (cumulative-report scheme; design doc
// ch.5 (2)B: the app reports cumulative seconds, the server charges the delta)
// ---------------------------------------------------------------------------

type RtSessionItem = {
  chargedSeconds?: number;
  finalized?: boolean;
};

export const startRtSession = async (
  userId: string,
  sessionId: string,
  mode: 'mic' | 'screen'
): Promise<void> => {
  try {
    await dynamoDbDocument.send(
      new PutCommand({
        TableName: LICENSE_TABLE_NAME,
        Item: {
          pk: userPk(userId),
          sk: `transcribe-rt#${sessionId}`,
          mode,
          chargedSeconds: 0,
          finalized: false,
          createdDate: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + RT_SESSION_TTL_SECONDS,
        },
        ConditionExpression: 'attribute_not_exists(sk)',
      })
    );
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      return; // already started (retried start request) — fine
    }
    throw e;
  }
};

// Charge the delta between the reported cumulative seconds and what has
// already been charged for this session. Duplicate and out-of-order reports
// are harmless (delta <= 0 -> no charge); a lost report is recovered by the
// next one (cumulative scheme).
export const reportRtSession = async (
  userId: string,
  sessionId: string,
  cumulativeSeconds: number,
  final: boolean
): Promise<void> => {
  const settings = await getLicenseSettings();
  const fx = await getFxRate();
  if (!fx) throw new Error('[license] fx rate is not available');
  const allocationYen = await resolveAllocationYen(userId);
  const sessionKey = { pk: userPk(userId), sk: `transcribe-rt#${sessionId}` };

  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    const res = await dynamoDbDocument.send(
      new GetCommand({ TableName: LICENSE_TABLE_NAME, Key: sessionKey })
    );
    const session = (res.Item ?? {}) as RtSessionItem;
    const prev = session.chargedSeconds ?? 0;
    const alreadyFinalized = session.finalized === true;

    let billableSeconds = Math.max(0, cumulativeSeconds - prev);
    if (final && !alreadyFinalized) {
      // Minimum billing (15s) is settled on the final report
      const total = Math.max(cumulativeSeconds, prev);
      if (total < settings.minBillableSeconds) {
        billableSeconds += settings.minBillableSeconds - total;
      }
    }
    const newCharged = Math.max(
      prev,
      cumulativeSeconds,
      final ? settings.minBillableSeconds : 0
    );

    if (billableSeconds <= 0 && (!final || alreadyFinalized)) {
      return; // nothing new to charge
    }

    const yen = calcTranscribeCostYen(
      billableSeconds,
      settings.transcribeStreamingUsdPerMinute,
      fx.rateJpyPerUsd
    );

    const sessionUpdate = {
      TableName: LICENSE_TABLE_NAME,
      Key: sessionKey,
      UpdateExpression:
        'SET chargedSeconds = :new, finalized = :finalized, updatedDate = :now, ' +
        '#ttl = if_not_exists(#ttl, :ttl)',
      ConditionExpression:
        'attribute_not_exists(chargedSeconds) OR chargedSeconds = :prev',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':new': newCharged,
        ':prev': prev,
        ':finalized': final || alreadyFinalized,
        ':now': new Date().toISOString(),
        ':ttl': Math.floor(Date.now() / 1000) + RT_SESSION_TTL_SECONDS,
      },
    };

    try {
      if (yen > 0) {
        await dynamoDbDocument.send(
          new TransactWriteCommand({
            TransactItems: [
              { Update: sessionUpdate },
              {
                Update: buildLedgerUpdate(
                  userId,
                  yen,
                  'transcribe',
                  allocationYen
                ),
              },
            ],
          })
        );
      } else {
        await dynamoDbDocument.send(new UpdateCommand(sessionUpdate));
      }
      return;
    } catch (e) {
      // Concurrent report for the same session — retry against fresh state
      const isConditional =
        (e as { name?: string }).name === 'ConditionalCheckFailedException' ||
        (
          e as { CancellationReasons?: { Code?: string }[] }
        ).CancellationReasons?.some((r) => r.Code === 'ConditionalCheckFailed');
      if (!isConditional || attempt >= maxAttempts) throw e;
    }
  }
};

// ---------------------------------------------------------------------------
// Admin: usage summary (requirement 35)
// ---------------------------------------------------------------------------

export const listAssignments = async (): Promise<
  { userId: string; assignment: Assignment }[]
> => {
  const results: { userId: string; assignment: Assignment }[] = [];
  let lastKey: Record<string, unknown> | undefined = undefined;
  do {
    const res: {
      Items?: Record<string, unknown>[];
      LastEvaluatedKey?: Record<string, unknown>;
    } = await dynamoDbDocument.send(
      new ScanCommand({
        TableName: LICENSE_TABLE_NAME,
        FilterExpression: 'sk = :sk',
        ExpressionAttributeValues: { ':sk': 'assignment' },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of res.Items ?? []) {
      results.push({
        userId: (item.pk as string).replace(/^user#/, ''),
        assignment: item as unknown as Assignment,
      });
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return results;
};
