// License plan management tab. Provides CRUD for plans (name / monthly limit / enabled).
// APIs come from useLicenseApi() (listLicensePlans/createLicensePlan/updateLicensePlan/deleteLicensePlan).
// Not to be confused with useLicense(), the hook for the caller's own remaining-count badge.
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PiPlus, PiPencil, PiTrash } from 'react-icons/pi';
import useLicenseApi from '../../hooks/useLicenseApi';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import ModalDialog from '../../components/ModalDialog';
import Switch from '../../components/Switch';
import { LicensePlan } from 'generative-ai-use-cases';

const DEFAULT_MONTHLY_LIMIT = 100;

const LicenseManagement: React.FC = () => {
  const { t } = useTranslation();
  const {
    listLicensePlans,
    createLicensePlan,
    updateLicensePlan,
    deleteLicensePlan,
  } = useLicenseApi();
  const { data, mutate, isLoading } = listLicensePlans();

  const plans = data?.plans ?? [];

  // Create/Edit dialog (shared form)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<LicensePlan | null>(null);
  const [formName, setFormName] = useState('');
  const [formMonthlyLimit, setFormMonthlyLimit] = useState(
    DEFAULT_MONTHLY_LIMIT
  );
  const [formEnabled, setFormEnabled] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete confirm dialog
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState<LicensePlan | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [error, setError] = useState('');

  const openCreateDialog = useCallback(() => {
    setEditingPlan(null);
    setFormName('');
    setFormMonthlyLimit(DEFAULT_MONTHLY_LIMIT);
    setFormEnabled(true);
    setFormError('');
    setIsFormOpen(true);
  }, []);

  const openEditDialog = useCallback((plan: LicensePlan) => {
    setEditingPlan(plan);
    setFormName(plan.name);
    setFormMonthlyLimit(plan.monthlyLimit);
    setFormEnabled(plan.enabled);
    setFormError('');
    setIsFormOpen(true);
  }, []);

  const openDeleteDialog = useCallback((plan: LicensePlan) => {
    setDeletingPlan(plan);
    setIsDeleteOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!formName.trim() || formMonthlyLimit <= 0) return;
    setFormLoading(true);
    setFormError('');
    try {
      if (editingPlan) {
        await updateLicensePlan(editingPlan.planId, {
          name: formName.trim(),
          monthlyLimit: formMonthlyLimit,
          enabled: formEnabled,
        });
      } else {
        await createLicensePlan({
          name: formName.trim(),
          monthlyLimit: formMonthlyLimit,
          enabled: formEnabled,
        });
      }
      await mutate();
      setIsFormOpen(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setFormError(
        err?.response?.data?.error ??
          (editingPlan
            ? t('license.plan_update_error')
            : t('license.plan_create_error'))
      );
    } finally {
      setFormLoading(false);
    }
  }, [
    editingPlan,
    formName,
    formMonthlyLimit,
    formEnabled,
    createLicensePlan,
    updateLicensePlan,
    mutate,
    t,
  ]);

  const handleDelete = useCallback(async () => {
    if (!deletingPlan) return;
    setDeleteLoading(true);
    setError('');
    try {
      await deleteLicensePlan(deletingPlan.planId);
      await mutate();
      setIsDeleteOpen(false);
      setDeletingPlan(null);
    } catch {
      setError(t('license.plan_delete_error'));
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingPlan, deleteLicensePlan, mutate, t]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8 text-gray-500">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <Alert
          severity="error"
          className="mb-4"
          onDissmiss={() => setError('')}>
          {error}
        </Alert>
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {t('license.plans_total', { count: plans.length })}
        </div>
        <Button onClick={openCreateDialog}>
          <PiPlus className="mr-1" />
          {t('license.create_plan')}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-xs text-gray-500">
              <th className="px-3 py-2">{t('license.plan_name')}</th>
              <th className="px-3 py-2">{t('license.monthly_limit')}</th>
              <th className="px-3 py-2">{t('license.enabled')}</th>
              <th className="px-3 py-2">{t('admin.users.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.planId} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2">{plan.name}</td>
                <td className="px-3 py-2">
                  {t('license.times_per_month', { count: plan.monthlyLimit })}
                </td>
                <td className="px-3 py-2">
                  {plan.enabled ? (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      {t('license.enabled_yes')}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {t('license.enabled_no')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                      title={t('common.edit')}
                      onClick={() => openEditDialog(plan)}>
                      <PiPencil />
                    </button>
                    <button
                      className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
                      title={t('common.delete')}
                      onClick={() => openDeleteDialog(plan)}>
                      <PiTrash />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Plan Dialog */}
      <ModalDialog
        isOpen={isFormOpen}
        title={
          editingPlan
            ? t('license.edit_plan_title')
            : t('license.create_plan_title')
        }
        onClose={() => setIsFormOpen(false)}>
        <div className="space-y-4">
          {formError && <Alert severity="error">{formError}</Alert>}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t('license.plan_name')}
            </label>
            <input
              type="text"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-0"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t('license.monthly_limit')}
            </label>
            <input
              type="number"
              min={1}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-0"
              value={formMonthlyLimit}
              onChange={(e) =>
                setFormMonthlyLimit(parseInt(e.target.value, 10) || 0)
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              {t('license.enabled')}
            </label>
            <Switch checked={formEnabled} label="" onSwitch={setFormEnabled} />
          </div>
          <div className="flex justify-end gap-2">
            <Button outlined onClick={() => setIsFormOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              loading={formLoading}
              disabled={!formName.trim() || formMonthlyLimit <= 0}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </ModalDialog>

      {/* Delete Confirm Dialog */}
      <ModalDialog
        isOpen={isDeleteOpen}
        title={t('license.delete_confirm_title')}
        onClose={() => setIsDeleteOpen(false)}>
        <div className="space-y-4">
          <div className="text-sm">
            {t('license.delete_confirm', { name: deletingPlan?.name })}
          </div>
          <div className="flex justify-end gap-2">
            <Button outlined onClick={() => setIsDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleDelete}
              loading={deleteLoading}
              className="bg-red-500 text-white">
              {t('license.delete_plan')}
            </Button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
};

export default LicenseManagement;
