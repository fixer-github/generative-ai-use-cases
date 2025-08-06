import { UpdateTitleRequest } from 'generative-ai-use-cases';
import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const chatId = event.pathParameters!.chatId!;
  const req: UpdateTitleRequest = JSON.parse(event.body!);

  const chatItem = await repo.findChatById(userId, chatId);

  if (!chatItem) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: '',
    };
  }

  const updatedChat = await repo.setChatTitle(
    chatItem?.id,
    chatItem?.createdDate,
    req.title
  );

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ chat: updatedChat }),
  };
});
