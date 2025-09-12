import { BotEntity } from 'generative-ai-use-cases';

export const ableToAccessThisBot = (userId: string, bot: BotEntity): boolean =>
  bot.userId === userId || bot.publicInOrg;
