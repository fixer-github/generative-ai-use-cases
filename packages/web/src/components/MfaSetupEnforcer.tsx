import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchMFAPreference,
  setUpTOTP,
  verifyTOTPSetup,
  updateMFAPreference,
} from 'aws-amplify/auth';
import QRCode from 'qrcode';
import Button from './Button';

const mfaRequired: boolean = import.meta.env.VITE_APP_MFA_REQUIRED === 'true';

type Props = {
  children: React.ReactNode;
};

const MfaSetupEnforcer: React.FC<Props> = ({ children }) => {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mfaRequired) {
      setChecking(false);
      return;
    }

    fetchMFAPreference()
      .then((pref) => {
        // TOTP is not set up if neither preferred nor enabled
        if (!pref.preferred && !pref.enabled) {
          setNeedsSetup(true);
        } else if (
          pref.preferred !== 'TOTP' &&
          !(pref.enabled && pref.enabled.includes('TOTP'))
        ) {
          setNeedsSetup(true);
        }
      })
      .catch(() => {
        // Require setup if fetching MFA preference fails
        setNeedsSetup(true);
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!needsSetup) return;

    setUpTOTP()
      .then(async (totpSetupDetails) => {
        const uri = totpSetupDetails.getSetupUri('GaiXer');
        const dataUrl = await QRCode.toDataURL(uri.toString(), {
          width: 200,
          margin: 2,
        });
        setQrDataUrl(dataUrl);
      })
      .catch(() => {
        setError('Failed to initialize TOTP setup.');
      });
  }, [needsSetup]);

  const handleVerify = useCallback(async () => {
    if (!verifyCode.trim()) return;
    setVerifying(true);
    setError('');
    try {
      await verifyTOTPSetup({ code: verifyCode.trim() });
      await updateMFAPreference({ totp: 'PREFERRED' });
      setNeedsSetup(false);
    } catch {
      setError(t('auth.mfa.verify_error'));
    } finally {
      setVerifying(false);
    }
  }, [verifyCode, t]);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-500">{t('auth.loading')}</div>
      </div>
    );
  }

  if (!needsSetup) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <div className="mb-6 text-center">
          <h2 className="text-aws-font-color text-xl font-semibold">
            {t('auth.mfa.force_setup_title')}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {t('auth.mfa.force_setup_description')}
          </p>
        </div>

        <div className="space-y-6">
          <ol className="marker:text-aws-sky list-inside list-decimal space-y-1 text-sm text-gray-700 marker:font-semibold">
            <li>{t('auth.mfa.setup_step1')}</li>
            <li>{t('auth.mfa.setup_step2')}</li>
          </ol>

          {qrDataUrl && (
            <div className="flex justify-center">
              <img
                src={qrDataUrl}
                alt={t('auth.mfa.setup_step1')}
                className="h-48 w-48"
              />
            </div>
          )}

          <div>
            {/* eslint-disable-next-line @shopify/jsx-no-hardcoded-content */}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="w-full rounded border border-gray-300 px-3 py-2 text-center text-lg tracking-widest focus:border-gray-400 focus:outline-none focus:ring-0"
              placeholder="000000"
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleVerify();
              }}
            />
          </div>

          {error && (
            <div className="rounded bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleVerify}
            loading={verifying}
            disabled={verifyCode.length !== 6}>
            {t('auth.mfa.verify_button')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MfaSetupEnforcer;
