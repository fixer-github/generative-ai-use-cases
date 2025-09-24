import { toast } from 'sonner';

export const useToast = () => {
  return {
    show: (
      message: string,
      type: 'success' | 'error' | 'warning' | 'info' = 'info'
    ) => {
      switch (type) {
        case 'success':
          toast.success(message);
          break;
        case 'error':
          toast.error(message);
          break;
        case 'warning':
          toast.warning(message);
          break;
        case 'info':
        default:
          toast.info(message);
          break;
      }
    },
  };
};
