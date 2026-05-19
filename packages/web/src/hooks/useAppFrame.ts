import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { CustomAppConfiguration } from 'generative-ai-use-cases';
import useAppNotificationStore from './useAppNotificationStore';
import { v4 as uuidv4 } from 'uuid';

// postMessage envelope structure
type GaixerMessage = {
  type: string;
  appId?: string;
  payload: Record<string, unknown>;
  messageId: string;
  timestamp: number;
};

type AppFrameStatus = 'loading' | 'ready' | 'initialized' | 'error';

type UseAppFrameOptions = {
  apps: CustomAppConfiguration[];
  sessionId: string;
  parentOrigin: string;
};

const useAppFrame = ({ apps, sessionId }: UseAppFrameOptions) => {
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map());
  const [appStatuses, setAppStatuses] = useState<Map<string, AppFrameStatus>>(
    new Map()
  );
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [activeAppId, setActiveAppId] = useState<string | null>(
    apps.length > 0 ? apps[0].id : null
  );

  // Build origin whitelist from registered app URLs
  const allowedOrigins = useRef<Set<string>>(new Set());
  useEffect(() => {
    const origins = new Set<string>();
    for (const app of apps) {
      try {
        const url = new URL(app.url);
        origins.add(url.origin);
      } catch {
        console.warn(`Invalid app URL: ${app.url}`);
      }
    }
    allowedOrigins.current = origins;
  }, [apps]);

  // Send a postMessage to a specific app's iframe
  const sendMessage = useCallback(
    (appId: string, type: string, payload: Record<string, unknown>) => {
      const iframe = iframeRefs.current.get(appId);
      const app = apps.find((a) => a.id === appId);
      if (!iframe?.contentWindow || !app) return;

      let targetOrigin: string;
      try {
        targetOrigin = new URL(app.url).origin;
      } catch {
        return;
      }

      const message: GaixerMessage = {
        type,
        appId,
        payload,
        messageId: uuidv4(),
        timestamp: Date.now(),
      };

      iframe.contentWindow.postMessage(message, targetOrigin);
    },
    [apps]
  );

  // Handle init sequence: send auth tokens and session info
  const sendInit = useCallback(
    async (appId: string) => {
      try {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString();
        const accessToken = session.tokens?.accessToken?.toString();

        if (!idToken) {
          console.error('Failed to get auth token for app init');
          return;
        }

        const idTokenPayload = session.tokens?.idToken?.payload;
        const displayName =
          (idTokenPayload?.['custom:displayName'] as string) ??
          (idTokenPayload?.['name'] as string) ??
          (idTokenPayload?.['email'] as string) ??
          '';

        const expClaim = session.tokens?.idToken?.payload?.exp;
        const expiresAt =
          typeof expClaim === 'number' ? expClaim * 1000 : Date.now() + 3600000;

        sendMessage(appId, 'gaixer:lifecycle:init', {
          auth: {
            idToken,
            accessToken,
            expiresAt,
          },
          user: {
            sub: session.userSub ?? '',
            displayName,
          },
          app: {
            appId,
            sessionId,
          },
        });
      } catch (error) {
        console.error('Error sending init to app:', error);
      }
    },
    [sendMessage, sessionId]
  );

  // Handle token refresh request from iframe
  const handleTokenRefresh = useCallback(
    async (appId: string) => {
      try {
        const session = await fetchAuthSession({ forceRefresh: true });
        const idToken = session.tokens?.idToken?.toString();
        const accessToken = session.tokens?.accessToken?.toString();

        const expClaim = session.tokens?.idToken?.payload?.exp;
        const expiresAt =
          typeof expClaim === 'number' ? expClaim * 1000 : Date.now() + 3600000;

        sendMessage(appId, 'gaixer:auth:refresh-response', {
          status: 'ok',
          auth: {
            idToken,
            accessToken,
            expiresAt,
          },
        });
      } catch (error) {
        sendMessage(appId, 'gaixer:auth:refresh-response', {
          status: 'error',
          errorMessage: 'Token refresh failed',
        });
      }
    },
    [sendMessage]
  );

  // Listen for postMessage events from iframes
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin
      if (!allowedOrigins.current.has(event.origin)) return;

      const data = event.data as GaixerMessage;
      if (!data?.type || typeof data.type !== 'string') return;

      // Find which app sent this message based on origin
      const senderApp = apps.find((app) => {
        try {
          return new URL(app.url).origin === event.origin;
        } catch {
          return false;
        }
      });
      if (!senderApp) return;

      switch (data.type) {
        case 'gaixer:lifecycle:ready':
          setAppStatuses((prev) => new Map(prev).set(senderApp.id, 'ready'));
          sendInit(senderApp.id);
          break;

        case 'gaixer:lifecycle:init-ack':
          if (data.payload?.status === 'ok') {
            setAppStatuses((prev) =>
              new Map(prev).set(senderApp.id, 'initialized')
            );
          } else {
            setAppStatuses((prev) => new Map(prev).set(senderApp.id, 'error'));
            console.error(
              `App ${senderApp.id} init failed:`,
              data.payload?.errorMessage
            );
          }
          break;

        case 'gaixer:auth:refresh-request':
          handleTokenRefresh(senderApp.id);
          break;

        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [apps, sendInit, handleTokenRefresh]);

  // Watch for appNotification from the agent stream and forward to iframe
  const { latestNotification, clearNotification } = useAppNotificationStore();

  useEffect(() => {
    if (!latestNotification) return;

    const targetApp = apps.find((a) => a.id === latestNotification.appId);
    if (!targetApp) {
      clearNotification();
      return;
    }

    // Auto-expand panel and switch to the notified app
    setIsPanelOpen(true);
    setActiveAppId(latestNotification.appId);

    // Forward notification to iframe as gaixer:data:updated
    sendMessage(latestNotification.appId, 'gaixer:data:updated', {
      appPayload: latestNotification.payload,
    });

    clearNotification();
  }, [latestNotification, apps, sendMessage, clearNotification]);

  // Register an iframe ref for an app
  const registerIframeRef = useCallback(
    (appId: string, el: HTMLIFrameElement | null) => {
      if (el) {
        iframeRefs.current.set(appId, el);
      } else {
        iframeRefs.current.delete(appId);
      }
    },
    []
  );

  // Toggle panel
  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => !prev);
  }, []);

  // Switch active app tab
  const switchApp = useCallback((appId: string) => {
    setActiveAppId(appId);
  }, []);

  return {
    isPanelOpen,
    setIsPanelOpen,
    togglePanel,
    activeAppId,
    switchApp,
    appStatuses,
    registerIframeRef,
  };
};

export default useAppFrame;
