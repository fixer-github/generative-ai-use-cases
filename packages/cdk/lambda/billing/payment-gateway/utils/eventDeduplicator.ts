import { WebhookEventRepository } from '../repositories/webhookEventRepository';

/**
 * イベントIDが既に処理されているかチェックする
 * @param eventId イベントID
 * @param repository WebhookEventRepository
 * @returns 重複している場合true
 */
export async function isDuplicateEvent(
  eventId: string,
  repository: WebhookEventRepository
): Promise<boolean> {
  const existingEvent = await repository.findByEventId(eventId);
  return existingEvent !== null;
}

/**
 * イベントIDのリストから重複をフィルタリングする
 * @param eventIds イベントIDのリスト
 * @param repository WebhookEventRepository
 * @returns 重複していないイベントIDのリスト
 */
export async function filterDuplicateEvents(
  eventIds: string[],
  repository: WebhookEventRepository
): Promise<string[]> {
  const checkPromises = eventIds.map(async (eventId) => {
    const isDuplicate = await isDuplicateEvent(eventId, repository);
    return { eventId, isDuplicate };
  });

  const results = await Promise.all(checkPromises);

  return results
    .filter((result) => !result.isDuplicate)
    .map((result) => result.eventId);
}
