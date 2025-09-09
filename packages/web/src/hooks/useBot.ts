import {
  BotCreateRequest,
  BotCreateResponse,
  BotListResponse,
} from 'generative-ai-use-cases';
import useHttp from './useHttp';

const useBot = () => {
  const http = useHttp();

  return {
    createBot: async (req: BotCreateRequest): Promise<BotCreateResponse> => {
      const res = await http.post<BotCreateResponse>('/bot', req);
      return res.data;
    },
    listBots: () => {
      return http.get<BotListResponse>('/bot');
    },
  };
};

export default useBot;
