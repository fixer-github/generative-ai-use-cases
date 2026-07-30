// License plan management tab (cash-based). Provides CRUD for plans
// (name / monthly fee JPY / allocation JPY / allowed models / enabled).
// APIs come from useLicenseApi() (listLicensePlans/createLicensePlan/
// updateLicensePlan/deleteLicensePlan). "Delete" is a soft-disable on the
// server side, so the UI wording is "disable" (license.admin.delete_plan).
// Per requirement 36, no consumption amounts (JPY/tokens) are shown here.
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PiPlus, PiPencil, PiProhibit } from 'react-icons/pi';
import useLicenseApi from '../../hooks/useLicenseApi';
import { MODELS } from '../../hooks/useModel';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import ModalDialog from '../../components/ModalDialog';
import Switch from '../../components/Switch';
import { LicensePlan } from 'generative-ai-use-cases';

const DEFAULT_MONTHLY_FEE_YEN = 0;
const DEFAULT_ALLOCATION_YEN = 0;

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
  const availableModelIds = MODELS.textModels.map((model) => model.modelId);

  // Create/Edit dialog (shared form)
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<LicensePlan | null>(null);
  const [formName, setFormName] = useState('');
  const [formMonthlyFeeYen, setFormMonthlyFeeYen] = useState(
    DEFAULT_MONTHLY_FEE_YEN
  );
  const [formAllocationYen, setFormAllocationYen] = useState(
    DEFAULT_ALLOCATION_YEN
  );
  const [formModelIds, setFormModelIds] = useState<string[]>([]);
  const [formEnabled, setFormEnabled] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Disable confirm dialog
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState<LicensePlan | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [error, setError] = useState('');

  const isFormValid =
    formName.trim().length > 0 &&
    Number.isFinite(formMonthlyFeeYen) &&
    formMonthlyFeeYen >= 0 &&
    Number.isFinite(formAllocationYen) &&
    formAllocationYen > 0 &&
    formModelIds.length > 0;

  const openCreateDialog = useCallback(() => {
    setEditingPlan(null);
    setFormName('');
    setFormMonthlyFeeYen(DEFAULT_MONTHLY_FEE_YEN);
    setFormAllocationYen(DEFAULT_ALLOCATION_YEN);
    setFormModelIds([]);
    setFormEnabled(true);
    setFormError('');
    setIsFormOpen(true);
  }, []);

  const openEditDialog = useCallback((plan: LicensePlan) => {
    setEditingPlan(plan);
    setFormName(plan.name);
    setFormMonthlyFeeYen(plan.monthlyFeeYen);
    setFormAllocationYen(plan.allocationYen);
    setFormModelIds(plan.allowedModelIds);
    setFormEnabled(plan.enabled);
    setFormError('');
    setIsFormOpen(true);
  }, []);

  const openDeleteDialog = useCallback((plan: LicensePlan) => {
    setDeletingPlan(plan);
    setIsDeleteOpen(true);
  }, []);

  const toggleModelId = useCallback((modelId: string) => {
    setFormModelIds((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId]
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isFormValid) return;
    setFormLoading(true);
    setFormError('');
    try {
      if (editingPlan) {
        await updateLicensePlan(editingPlan.planId, {
          name: formName.trim(),
          monthlyFeeYen: formMonthlyFeeYen,
          allocationYen: formAllocationYen,
          allowedModelIds: formModelIds,
          enabled: formEnabled,
        });
      } else {
        await createLicensePlan({
          name: formName.trim(),
          monthlyFeeYen: formMonthlyFeeYen,
          allocationYen: formAllocationYen,
          allowedModelIds: formModelIds,
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
            ? t('license.admin.plan_update_error')
            : t('license.admin.plan_create_error'))
      );
    } finally {
      setFormLoading(false);
    }
  }, [
    isFormValid,
    editingPlan,
    formName,
    formMonthlyFeeYen,
    formAllocationYen,
    formModelIds,
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
      setError(t('license.admin.plan_delete_error'));
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
          {t('license.admin.plans_total', { count: plans.length })}
        </div>
        <Button onClick={openCreateDialog}>
          <PiPlus className="mr-1" />
          {t('license.admin.create_plan')}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-xs text-gray-500">
              <th className="px-3 py-2">{t('license.admin.plan_name')}</th>
              <th className="px-3 py-2">
                {t('license.admin.monthly_fee_yen')}
              </th>
              <th className="px-3 py-2">{t('license.admin.allocation_yen')}</th>
              <th className="px-3 py-2">{t('license.admin.models')}</th>
              <th className="px-3 py-2">{t('license.admin.enabled')}</th>
              <th className="px-3 py-2">{t('admin.users.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.planId} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2">{plan.name}</td>
                <td className="px-3 py-2">
                  {plan.monthlyFeeYen.toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {plan.allocationYen.toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <div className="flex max-w-md flex-wrap gap-1">
                    {plan.allowedModelIds.map((modelId) => (
                      <span
                        key={modelId}
                        className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                        {MODELS.modelDisplayName(modelId)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {plan.enabled ? (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      {t('license.admin.enabled_yes')}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {t('license.admin.enabled_no')}
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
                      className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      title={t('license.admin.delete_plan')}
                      disabled={!plan.enabled}
                      onClick={() => openDeleteDialog(plan)}>
                      <PiProhibit />
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
            ? t('license.admin.edit_plan_title')
            : t('license.admin.create_plan_title')
        }
        onClose={() => setIsFormOpen(false)}>
        <div className="space-y-4">
          {formError && <Alert severity="error">{formError}</Alert>}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t('license.admin.plan_name')}
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
              {t('license.admin.monthly_fee_yen')}
            </label>
            <input
              type="number"
              min={0}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-0"
              value={formMonthlyFeeYen}
              onChange={(e) =>
                setFormMonthlyFeeYen(parseInt(e.target.value, 10) || 0)
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t('license.admin.allocation_yen')}
            </label>
            <input
              type="number"
              min={1}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-0"
              value={formAllocationYen}
              onChange={(e) =>
                setFormAllocationYen(parseInt(e.target.value, 10) || 0)
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t('license.admin.models')}
            </label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-gray-300 p-2">
              {availableModelIds.map((modelId) => (
                <label
                  key={modelId}
                  className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={formModelIds.includes(modelId)}
                    onChange={() => toggleModelId(modelId)}
                  />
                  {MODELS.modelDisplayName(modelId)}
                </label>
              ))}
            </div>
            {formModelIds.length === 0 && (
              <div className="mt-1 text-xs text-red-500">
                {t('license.admin.models_required')}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              {t('license.admin.enabled')}
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
              disabled={!isFormValid}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </ModalDialog>

      {/* Disable Confirm Dialog */}
      <ModalDialog
        isOpen={isDeleteOpen}
        title={t('license.admin.delete_confirm_title')}
        onClose={() => setIsDeleteOpen(false)}>
        <div className="space-y-4">
          <div className="text-sm">
            {t('license.admin.delete_confirm', { name: deletingPlan?.name })}
          </div>
          <div className="flex justify-end gap-2">
            <Button outlined onClick={() => setIsDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleDelete}
              loading={deleteLoading}
              className="bg-red-500 text-white">
              {t('license.admin.delete_plan')}
            </Button>
          </div>
        </div>
      </ModalDialog>
    </div>
  );
};

export default LicenseManagement;
