import React, { useEffect, useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js';
import { PiX, PiSpinnerGap } from 'react-icons/pi';
import useSubscriptionApi from '../hooks/useSubscriptionApi';

interface StripeCheckoutModalProps {
  clientSecret: string;
  onClose: () => void;
  onSuccess: () => void;
}

const StripeCheckoutModal: React.FC<StripeCheckoutModalProps> = ({
  clientSecret,
  onClose,
  onSuccess,
}) => {
  const subscriptionApi = useSubscriptionApi();
  const [loading, setLoading] = useState(false);
  const [stripePromise, setStripePromise] =
    useState<Promise<Stripe | null> | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);

  // Fetch Stripe publishable key from API
  useEffect(() => {
    const fetchStripeKey = async () => {
      try {
        const storeInfo = await subscriptionApi.getStoreInfo();
        if (storeInfo.stripePublishableKey) {
          setStripePromise(loadStripe(storeInfo.stripePublishableKey));
        } else {
          setStripeError(
            'Stripeの設定が完了していません。管理者にお問い合わせください。'
          );
        }
      } catch (error) {
        console.error('Failed to fetch store info:', error);
        setStripeError('ストア情報の取得に失敗しました。');
      }
    };
    fetchStripeKey();
  }, [subscriptionApi]);

  // Handle return from Stripe Checkout
  const handleCheckoutReturn = useCallback(async () => {
    // Parse the session_id from URL if present
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');

    if (!sessionId) {
      return;
    }

    setLoading(true);
    try {
      // Check session status
      const sessionStatus = await subscriptionApi.getSessionStatus(sessionId);

      if (sessionStatus.status === 'complete') {
        // Activate subscription
        const activationResult = await subscriptionApi.activateFromSession({
          sessionId: sessionId,
        });

        if (activationResult.success) {
          // Clear URL parameters
          const url = new URL(window.location.href);
          url.searchParams.delete('session_id');
          window.history.replaceState({}, document.title, url.toString());

          // Notify success
          onSuccess();
        }
      }
    } catch (error) {
      console.error('Failed to handle checkout return:', error);
    } finally {
      setLoading(false);
    }
  }, [subscriptionApi, onSuccess]);

  useEffect(() => {
    handleCheckoutReturn();
  }, [handleCheckoutReturn]);

  const options = {
    clientSecret,
  };

  return (
    <Dialog.Root open={true} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[60] bg-black/50" />
        <Dialog.Content className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed left-[50%] top-[50%] z-[60] flex h-[90vh] w-[90vw] max-w-4xl translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              プランの購入
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100 focus:outline-none"
                aria-label="閉じる">
                <PiX className="h-5 w-5 text-gray-500" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {stripeError ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <p className="text-sm text-red-600">{stripeError}</p>
                </div>
              </div>
            ) : loading || !stripePromise ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <PiSpinnerGap className="mx-auto h-8 w-8 animate-spin text-gray-400" />
                  <p className="mt-2 text-sm text-gray-600">
                    {loading ? '処理中...' : '読み込み中...'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-full">
                <EmbeddedCheckoutProvider
                  stripe={stripePromise}
                  options={options}>
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default StripeCheckoutModal;
