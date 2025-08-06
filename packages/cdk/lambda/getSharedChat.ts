import { withTenantRepository } from './tenantRepository';

export const handler = withTenantRepository(async (repo, userId, event) => {
  const shareId = event.pathParameters!.shareId!;
  const res = await repo.findUserIdAndChatId(shareId);

  if (res === null) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: '',
    };
  }

  const userIdFromShare = res.userId;
  const chatId = res.chatId;

  const chat = await repo.findChatById(
    // SAML authentication includes # in userId
    // Example: user#EntraID_hogehoge.com#EXT#@hogehoge.onmicrosoft.com
    userIdFromShare.split('#').slice(1).join('#'),
    chatId.split('#')[1]
  );
  const messages = await repo.listMessages(chatId.split('#')[1]);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      chat,
      messages,
    }),
  };
});
