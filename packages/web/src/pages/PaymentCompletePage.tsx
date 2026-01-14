import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PiSpinnerGap, PiCheckCircle, PiXCircle, PiWarningCircle } from 'react-icons/pi';
import useSubscriptionApi from '../hooks/useSubscriptionApi';

const PaymentCompletePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const subscriptionApi = useSubscriptionApi();

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'processing'>('loading');
  const [message, setMessage] = useState('');
  const [planName, setPlanName] = useState('');
  const [nextBillingDate, setNextBillingDate] = useState('');

  useEffect(() => {
    const processPayment = async () => {
      const sessionId = searchParams.get('session_id');

      if (!sessionId) {
        setStatus('error');
        setMessage('セッション情報が見つかりません。');
        return;
      }

      try {
        // Step 1: Check session status
        const sessionStatus = await subscriptionApi.getSessionStatus(sessionId);

        if (sessionStatus.status === 'complete') {
          // Step 2: Activate subscription
          const activationResult = await subscriptionApi.activateFromSession({
            sessionId: sessionId,
          });

          if (activationResult.success) {
            setStatus('success');
            setMessage('プランが有効になりました。今すぐご利用いただけます。');
            setPlanName(activationResult.planName || '');
            setNextBillingDate(activationResult.nextBillingDate || '');
          } else {
            if (activationResult.error === 'already_processed') {
              // Already processed, show success
              setStatus('success');
              setMessage('プランは既に有効化されています。');
            } else {
              setStatus('error');
              setMessage(activationResult.message || 'プランの有効化に失敗しました。');
            }
          }
        } else if (sessionStatus.status === 'incomplete') {
          setStatus('processing');
          setMessage('支払い処理を確認中です。しばらくお待ちください。');

          // Retry after a delay
          setTimeout(() => {
            processPayment();
          }, 3000);
        } else {
          setStatus('error');
          setMessage('支払いが完了していません。');
        }
      } catch (error) {
        console.error('Payment processing error:', error);
        setStatus('error');
        setMessage('支払いの処理中にエラーが発生しました。サポートにお問い合わせください。');
      }
    };

    processPayment();
  }, [searchParams, subscriptionApi]);

  const handleNavigateToSettings = () => {
    navigate('/');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        {status === 'loading' && (
          <div className="text-center">
            <PiSpinnerGap className="mx-auto h-12 w-12 animate-spin text-blue-600" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900">支払い処理を確認中...</h2>
            <p className="mt-2 text-sm text-gray-600">しばらくお待ちください。</p>
          </div>
        )}

        {status === 'processing' && (
          <div className="text-center">
            <PiSpinnerGap className="mx-auto h-12 w-12 animate-spin text-yellow-600" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900">{message}</h2>
            <p className="mt-2 text-sm text-gray-600">自動的に更新されます。</p>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center">
            <PiCheckCircle className="mx-auto h-12 w-12 text-green-600" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900">支払いが完了しました</h2>
            <p className="mt-2 text-sm text-gray-600">{message}</p>

            {planName && (
              <div className="mt-6 rounded-lg bg-green-50 p-4">
                <p className="text-sm font-medium text-green-900">{planName}</p>
                {nextBillingDate && (
                  <p className="mt-1 text-xs text-green-700">
                    次回請求日: {new Date(nextBillingDate).toLocaleDateString('ja-JP')}
                  </p>
                )}
              </div>
            )}

            <button
              onClick={handleNavigateToSettings}
              className="mt-6 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              ホームに戻る
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center">
            <PiXCircle className="mx-auto h-12 w-12 text-red-600" />
            <h2 className="mt-4 text-lg font-semibold text-gray-900">エラーが発生しました</h2>
            <p className="mt-2 text-sm text-gray-600">{message}</p>

            <div className="mt-6 rounded-lg bg-yellow-50 p-4">
              <div className="flex">
                <PiWarningCircle className="h-5 w-5 shrink-0 text-yellow-400" />
                <p className="ml-2 text-sm text-yellow-700">
                  支払いは完了しましたが、プランの有効化に時間がかかっています。
                  数分以内に自動的に有効化されます。
                </p>
              </div>
            </div>

            <button
              onClick={handleNavigateToSettings}
              className="mt-6 w-full rounded-md bg-gray-600 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
              ホームに戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PaymentCompletePage;