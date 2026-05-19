import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useAdminApi from '../../hooks/useAdminApi';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import Switch from '../../components/Switch';
import ModalDialog from '../../components/ModalDialog';
import { PasswordPolicy } from 'generative-ai-use-cases';

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 20;
const lengthOptions = Array.from(
  { length: MAX_PASSWORD_LENGTH - MIN_PASSWORD_LENGTH + 1 },
  (_, i) => MIN_PASSWORD_LENGTH + i
);

const PasswordPolicySettings: React.FC = () => {
  const { t } = useTranslation();
  const { getPasswordPolicy, updatePasswordPolicy } = useAdminApi();
  const { data, isLoading, mutate } = getPasswordPolicy();

  const [policy, setPolicy] = useState<PasswordPolicy>({
    minimumLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (data?.policy) {
      setPolicy(data.policy);
      setHasChanges(false);
    }
  }, [data]);

  const updateField = useCallback(
    <K extends keyof PasswordPolicy>(key: K, value: PasswordPolicy[K]) => {
      setPolicy((prev) => ({ ...prev, [key]: value }));
      setHasChanges(true);
      setSuccess('');
    },
    []
  );

  const handleSave = useCallback(async () => {
    setConfirmOpen(false);
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await updatePasswordPolicy({
        policy: {
          ...policy,
          requireLowercase: true,
          requireNumbers: true,
        },
      });
      await mutate();
      setHasChanges(false);
      setSuccess(t('admin.password_policy.save_success'));
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(
        err?.response?.data?.error ?? t('admin.password_policy.save_error')
      );
    } finally {
      setSaving(false);
    }
  }, [policy, updatePasswordPolicy, mutate, t]);

  const handleReset = useCallback(() => {
    if (data?.policy) {
      setPolicy(data.policy);
      setHasChanges(false);
      setSuccess('');
    }
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8 text-gray-500">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      {error && (
        <Alert
          severity="error"
          className="mb-4"
          onDissmiss={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert
          severity="info"
          className="mb-4"
          onDissmiss={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <div className="space-y-1">
        {/* Minimum Length */}
        <div className="border-aws-squid-ink grid grid-cols-12 border-y border-solid px-1 py-3 hover:bg-gray-50">
          <div className="col-span-6 flex items-center text-sm">
            {t('admin.password_policy.minimum_length')}
          </div>
          <div className="col-span-6 flex items-center justify-end">
            <select
              value={policy.minimumLength}
              onChange={(e) =>
                updateField('minimumLength', parseInt(e.target.value, 10))
              }
              className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-400 focus:outline-none focus:ring-0">
              {lengthOptions.map((n) => (
                <option key={n} value={n}>
                  {t('admin.password_policy.length_chars', { count: n })}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Require Uppercase */}
        <div className="border-aws-squid-ink grid grid-cols-12 border-b border-solid px-1 py-3 hover:bg-gray-50">
          <div className="col-span-6 flex items-center text-sm">
            {t('admin.password_policy.require_uppercase')}
          </div>
          <div className="col-span-6 flex items-center justify-end">
            <Switch
              checked={policy.requireUppercase}
              label=""
              onSwitch={(val) => updateField('requireUppercase', val)}
            />
          </div>
        </div>

        {/* Require Symbols */}
        <div className="border-aws-squid-ink grid grid-cols-12 border-b border-solid px-1 py-3 hover:bg-gray-50">
          <div className="col-span-6 flex items-center text-sm">
            {t('admin.password_policy.require_symbols')}
          </div>
          <div className="col-span-6 flex items-center justify-end">
            <Switch
              checked={policy.requireSymbols}
              label=""
              onSwitch={(val) => updateField('requireSymbols', val)}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        <p>{t('admin.password_policy.fixed_requirements')}</p>
        <p className="mt-1">{t('admin.password_policy.note')}</p>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button outlined onClick={handleReset} disabled={!hasChanges}>
          {t('common.reset')}
        </Button>
        <Button
          onClick={() => setConfirmOpen(true)}
          loading={saving}
          disabled={!hasChanges}>
          {t('common.save')}
        </Button>
      </div>

      <ModalDialog
        isOpen={confirmOpen}
        title={t('admin.password_policy.save_confirm_title')}
        onClose={() => setConfirmOpen(false)}>
        <div>{t('admin.password_policy.save_confirm')}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            outlined
            onClick={() => setConfirmOpen(false)}
            className="p-2">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} className="p-2">
            {t('common.save')}
          </Button>
        </div>
      </ModalDialog>
    </div>
  );
};

export default PasswordPolicySettings;
