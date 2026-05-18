import { create } from 'zustand';
import { AppNotification } from 'generative-ai-use-cases';

type AppNotificationStore = {
  latestNotification: AppNotification | null;
  pushNotification: (notification: AppNotification) => void;
  clearNotification: () => void;
};

const useAppNotificationStore = create<AppNotificationStore>((set) => ({
  latestNotification: null,
  pushNotification: (notification) => set({ latestNotification: notification }),
  clearNotification: () => set({ latestNotification: null }),
}));

export default useAppNotificationStore;
