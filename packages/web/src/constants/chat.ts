/**
 * チャットIDのプレフィックス
 * DynamoDBに保存される際のフォーマット: "chat#<uuid>"
 */
export const CHAT_ID_PREFIX = 'chat#';

/**
 * ユーザーIDのプレフィックス
 * DynamoDBに保存される際のフォーマット: "user#<userId>"
 */
export const USER_ID_PREFIX = 'user#';
