/* eslint-disable i18nhelper/no-jp-string */
// Agent auto-suggestion for the new UI top page (synchronous, lightweight).
// Takes the user's free-text query plus candidate agents (id/name/description),
// asks the LLM to pick up to 3 best-matching agents, and returns them as JSON.
// Judge model is defaultModel (the deployed lightweight model, flags.light first).
// Design: see the top-page implementation memo (decision D, sections 2 and 7).
//
// The prompt strings below are intentionally Japanese: this is a Japanese
// medical product and the model judges Japanese queries/descriptions. Hence the
// file-level disable of i18nhelper/no-jp-string (same pattern as other lambdas).
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  AgentSuggestRequest,
  AgentSuggestResponse,
  Model,
  UnrecordedMessage,
} from 'generative-ai-use-cases';
import api from './utils/api';

// Judge model is supplied explicitly via cdk.json (agentSuggestModelId) and
// passed through as AGENT_SUGGEST_MODEL_ID. There is intentionally NO fallback
// to defaultModel: the suggestion endpoint must use the cheap/fast model chosen
// for this task, not whatever defaultModel happens to resolve to.
const AGENT_SUGGEST_MODEL_ID = process.env.AGENT_SUGGEST_MODEL_ID;
const MODEL_REGION = process.env.MODEL_REGION;

const suggestModel = (): Model => {
  if (!AGENT_SUGGEST_MODEL_ID) {
    // Misconfiguration (CDK marks this required, so it should never happen).
    throw new Error('AGENT_SUGGEST_MODEL_ID is not set');
  }
  return {
    type: 'bedrock',
    modelId: AGENT_SUGGEST_MODEL_ID,
    region: MODEL_REGION,
  };
};

const MAX_MATCHES = 3;
// Upper bound on candidates packed into the prompt (scale ceiling, memo 2.5).
// If official agents grow into the hundreds, a pre-filter (embedding) is needed.
const MAX_AGENTS = 50;

const json = (status: number, body: unknown): APIGatewayProxyResult => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(body),
});

const SYSTEM = `あなたは医療機関向けAIプラットフォームの「ルーター」です。
利用者が書いた依頼文を読み、用意された候補エージェントの中から、その依頼に最も適したものを選びます。

判定のルール：
- 各エージェントの「説明」を根拠に、依頼内容と合致するものだけを選ぶ。
- 確信を持って合致するものがなければ、無理に選ばず空にする（誤った誘導はしない）。
- 最大3件まで。合致度の高い順に並べる。
- reason は、なぜそのエージェントが合うのかを日本語の一文（30文字程度）で簡潔に述べる。

出力は次の JSON のみ。前後に説明文やコードフェンスを付けない：
{"matches":[{"id":"<候補のid>","reason":"<一文の理由>"}]}
合致なしのときは {"matches":[]} を返す。`;

const buildUserPrompt = (
  query: string,
  agents: AgentSuggestRequest['agents']
): string => {
  const list = agents
    .map(
      (a, i) =>
        `${i + 1}. id: ${a.id}\n   名前: ${a.name}\n   説明: ${a.description || '（説明なし）'}`
    )
    .join('\n');
  return `# 利用者の入力\n${query}\n\n# 候補エージェント\n${list}\n\n上記の候補から、入力に合うものを最大${MAX_MATCHES}件選び、指定の JSON で返してください。`;
};

// Extract and parse the JSON object from the LLM output, tolerating code fences
// or surrounding prose. Only ids present in the input are kept; capped to 3.
const parseMatches = (
  text: string,
  validIds: Set<string>
): AgentSuggestResponse['matches'] => {
  if (!text) return [];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const matches = (parsed as { matches?: unknown })?.matches;
  if (!Array.isArray(matches)) return [];
  const seen = new Set<string>();
  const result: AgentSuggestResponse['matches'] = [];
  for (const m of matches) {
    const id = (m as { id?: unknown })?.id;
    const reason = (m as { reason?: unknown })?.reason;
    if (typeof id !== 'string' || !validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      reason: typeof reason === 'string' ? reason.trim() : '',
    });
    if (result.length >= MAX_MATCHES) break;
  }
  return result;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return json(400, { message: 'Request body is missing' });
    }
    const req = JSON.parse(event.body) as AgentSuggestRequest;
    const query = (req.query || '').trim();
    const agents = (req.agents || []).slice(0, MAX_AGENTS);

    // Empty query / no candidates: return "no match" without calling the LLM.
    if (!query || agents.length === 0) {
      return json(200, { matches: [] } as AgentSuggestResponse);
    }

    const messages: UnrecordedMessage[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildUserPrompt(query, agents) },
    ];

    const text =
      (await api['bedrock'].invoke?.(
        suggestModel(),
        messages,
        'agent-suggest'
      )) ?? '';

    const validIds = new Set(agents.map((a) => a.id));
    const matches = parseMatches(text, validIds);

    return json(200, { matches } as AgentSuggestResponse);
  } catch (error) {
    console.log(error);
    // On failure, return no suggestions (empty); the top page send path falls
    // back to plain chat.
    return json(200, { matches: [] } as AgentSuggestResponse);
  }
};
