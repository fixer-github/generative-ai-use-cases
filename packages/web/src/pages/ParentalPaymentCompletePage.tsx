import React from 'react';
import { PiCheckCircle } from 'react-icons/pi';

/**
 * 保護者向け決済完了ページ
 * 認証不要のシンプルな完了メッセージを表示
 * サブスクリプションの有効化はWebhook経由で自動的に行われる
 */
const ParentalPaymentCompletePage: React.FC = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-lg">
        <div className="text-center">
          <PiCheckCircle className="mx-auto h-16 w-16 text-green-600" />
          <h1 className="mt-6 text-2xl font-bold text-gray-900">
            お支払いが完了しました
          </h1>
          <p className="mt-4 text-gray-600">
            ありがとうございます。お子様のアカウントは自動的に有効化されます。
          </p>
          <div className="mt-6 rounded-lg bg-blue-50 p-4">
            <p className="text-sm text-blue-800">
              このページは閉じていただいて構いません。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParentalPaymentCompletePage;
