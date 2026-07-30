// User management tab. In addition to the existing features, it provides a
// license column (plan / pending plan / remaining %) fed by the usage summary
// API and an assignment dialog. Per requirement 36, only percentages are
// shown; raw consumption amounts (JPY/tokens) are never displayed.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PiPlus,
  PiTrash,
  PiProhibit,
  PiCheckCircle,
  PiUserGear,
  PiShieldSlash,
  PiCreditCard,
} from 'react-icons/pi';
import useAdminApi from '../../hooks/useAdminApi';
import useAdmin from '../../hooks/useAdmin';
import useLicenseApi from '../../hooks/useLicenseApi';
import Button from '../../components/Button';
import Alert from '../../components/Alert';
import ModalDialog from '../../components/ModalDialog';
import {
  AdminUser,
  LicensePlan,
  LicenseUsageSummaryEntry,
} from 'generative-ai-use-cases';

// Renders "45%" etc. via Intl so no string literal is hardcoded in JSX.
const formatPercent = (percent: number): string => {
  const clamped = Math.max(0, Math.min(100, percent));
  return (clamped / 100).toLocaleString(undefined, {
    style: 'percent',
    maximumFractionDigits: 0,
  });
};

// License column cell: plan name, pending (next-month) plan and remaining %
// bar. Unassigned users cannot use the system at all, so the unassigned state
// is rendered as a clearly visible red badge rather than dimmed text.
const UserLicenseCell: React.FC<{
  entry?: LicenseUsageSummaryEntry;
  loaded: boolean;
}> = ({ entry, loaded }) => {
  const { t } = useTranslation();

  if (!loaded) {
    return (
      <div className="h-3 w-16 animate-pulse rounded bg-gray-200" aria-hidden />
    );
  }

  if (!entry || !entry.assigned) {
    return (
      <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        {t('license.admin.unassigned')}
      </span>
    );
  }

  const remainingPercent = Math.max(0, Math.min(100, entry.remainingPercent));

  return (
    <div className="text-xs">
      <div
        className={
          entry.exhausted ? 'font-medium text-red-600' : 'text-gray-700'
        }>
        {entry.planName}
      </div>
      {entry.pendingPlanName && (
        <div className="text-gray-500">
          {t('license.admin.pending_plan', { name: entry.pendingPlanName })}
        </div>
      )}
      <div className="mt-1 flex items-center gap-1.5">
        <div
          className={`h-1.5 w-16 overflow-hidden rounded-full ${
            entry.exhausted ? 'bg-red-100' : 'bg-gray-200'
          }`}>
          <div
            className={`h-full rounded-full ${
              entry.exhausted ? 'bg-red-500' : 'bg-aws-smile'
            }`}
            style={{ width: `${remainingPercent}%` }}
          />
        </div>
        <span
          className={
            entry.exhausted ? 'font-medium text-red-600' : 'text-gray-500'
          }
          title={t('license.admin.remaining')}>
          {formatPercent(entry.remainingPercent)}
        </span>
      </div>
    </div>
  );
};

// Assignment dialog. Only enabled plans are selectable, plus an explicit
// "unassigned" option (planId = null). When the change is scheduled for the
// next month ('nextMonth'), a notice is shown before the dialog is closed.
const AssignLicenseDialog: React.FC<{
  user: AdminUser;
  plans: LicensePlan[];
  onClose: () => void;
  onAssigned: () => void;
}> = ({ user, plans, onClose, onAssigned }) => {
  const { t } = useTranslation();
  const { getUserLicense, assignUserLicense } = useLicenseApi();
  const { data, mutate } = getUserLicense(user.username);

  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [appliedNextMonth, setAppliedNextMonth] = useState(false);

  useEffect(() => {
    if (data?.license && !initialized) {
      const currentPlanId = data.license.planId;
      setSelectedPlanId(
        currentPlanId && plans.some((p) => p.planId === currentPlanId)
          ? currentPlanId
          : ''
      );
      setInitialized(true);
    }
  }, [data, initialized, plans]);

  const handleAssign = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await assignUserLicense(user.username, {
        planId: selectedPlanId || null,
      });
      await mutate();
      onAssigned();
      if (res.applied === 'nextMonth') {
        setAppliedNextMonth(true);
      } else {
        onClose();
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setError(err?.response?.data?.error ?? t('license.admin.assign_error'));
    } finally {
      setLoading(false);
    }
  }, [user, selectedPlanId, assignUserLicense, mutate, onAssigned, onClose, t]);

  return (
    <ModalDialog
      isOpen
      title={t('license.admin.assign_title')}
      onClose={onClose}>
      <div className="space-y-4">
        {error && <Alert severity="error">{error}</Alert>}
        <div className="text-sm">
          {t('license.admin.assigning_user', {
            username: user.email || user.username,
          })}
        </div>
        {appliedNextMonth ? (
          <>
            <Alert severity="info">
              {t('license.admin.applied_next_month')}
            </Alert>
            <div className="flex justify-end">
              <Button onClick={onClose}>{t('common.close')}</Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('license.admin.select_plan')}
              </label>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-0">
                <option value="">{t('license.admin.unassigned')}</option>
                {plans.map((plan) => (
                  <option key={plan.planId} value={plan.planId}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button outlined onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleAssign} loading={loading}>
                {t('common.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </ModalDialog>
  );
};

const UserManagement: React.FC = () => {
  const { t } = useTranslation();
  const {
    listUsers,
    createUser,
    disableUser,
    enableUser,
    deleteUser,
    updateUserGroups,
    resetMfa,
  } = useAdminApi();
  const { currentUsername } = useAdmin();
  const { listLicensePlans, getLicenseUsageSummary } = useLicenseApi();

  const { data, mutate, isLoading } = listUsers();
  const { data: licensePlansData } = listLicensePlans();
  const { data: usageSummaryData, mutate: mutateUsageSummary } =
    getLicenseUsageSummary();

  const users = useMemo(() => data?.users ?? [], [data]);
  const enabledPlans = useMemo(
    () => (licensePlansData?.plans ?? []).filter((plan) => plan.enabled),
    [licensePlansData]
  );
  const usageByUserId = useMemo(() => {
    const map = new Map<string, LicenseUsageSummaryEntry>();
    for (const entry of usageSummaryData?.entries ?? []) {
      map.set(entry.userId, entry);
    }
    return map;
  }, [usageSummaryData]);
  const exhaustedCount = usageSummaryData?.exhaustedCount ?? 0;

  // Create user dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Groups dialog
  const [isGroupsOpen, setIsGroupsOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editingIsAdmin, setEditingIsAdmin] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);

  // Delete confirm dialog
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Reset MFA confirm dialog
  const [isResetMfaOpen, setIsResetMfaOpen] = useState(false);
  const [resetMfaUser, setResetMfaUser] = useState<AdminUser | null>(null);
  const [resetMfaLoading, setResetMfaLoading] = useState(false);

  // Assign license dialog
  const [assigningUser, setAssigningUser] = useState<AdminUser | null>(null);

  // Action loading state
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Error state
  const [error, setError] = useState('');

  const handleCreate = useCallback(async () => {
    if (!newEmail.trim()) return;
    setCreateLoading(true);
    setCreateError('');
    try {
      await createUser({
        email: newEmail.trim(),
        groups: newIsAdmin ? ['admin'] : [],
      });
      await mutate();
      setIsCreateOpen(false);
      setNewEmail('');
      setNewIsAdmin(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setCreateError(
        err?.response?.data?.error ?? t('admin.users.create_error')
      );
    } finally {
      setCreateLoading(false);
    }
  }, [newEmail, newIsAdmin, createUser, mutate, t]);

  const handleToggleEnabled = useCallback(
    async (user: AdminUser) => {
      setActionLoading(user.username);
      setError('');
      try {
        if (user.enabled) {
          await disableUser(user.username);
        } else {
          await enableUser(user.username);
        }
        await mutate();
      } catch {
        setError(t('admin.users.toggle_error'));
      } finally {
        setActionLoading(null);
      }
    },
    [disableUser, enableUser, mutate, t]
  );

  const handleDelete = useCallback(async () => {
    if (!deletingUser) return;
    setDeleteLoading(true);
    setError('');
    try {
      await deleteUser(deletingUser.username);
      await mutate();
      setIsDeleteOpen(false);
      setDeletingUser(null);
    } catch {
      setError(t('admin.users.delete_error'));
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingUser, deleteUser, mutate, t]);

  const handleUpdateGroups = useCallback(async () => {
    if (!editingUser) return;
    setGroupsLoading(true);
    setError('');
    try {
      const groups = editingIsAdmin ? ['admin'] : [];
      await updateUserGroups(editingUser.username, groups);
      await mutate();
      setIsGroupsOpen(false);
      setEditingUser(null);
    } catch {
      setError(t('admin.users.groups_error'));
    } finally {
      setGroupsLoading(false);
    }
  }, [editingUser, editingIsAdmin, updateUserGroups, mutate, t]);

  const handleResetMfa = useCallback(async () => {
    if (!resetMfaUser) return;
    setResetMfaLoading(true);
    setError('');
    try {
      await resetMfa(resetMfaUser.username);
      await mutate();
      setIsResetMfaOpen(false);
      setResetMfaUser(null);
    } catch {
      setError(t('admin.users.reset_mfa_error'));
    } finally {
      setResetMfaLoading(false);
    }
  }, [resetMfaUser, resetMfa, mutate, t]);

  const openResetMfaDialog = useCallback((user: AdminUser) => {
    setResetMfaUser(user);
    setIsResetMfaOpen(true);
  }, []);

  const openGroupsDialog = useCallback((user: AdminUser) => {
    setEditingUser(user);
    setEditingIsAdmin(user.groups.includes('admin'));
    setIsGroupsOpen(true);
  }, []);

  const openDeleteDialog = useCallback((user: AdminUser) => {
    setDeletingUser(user);
    setIsDeleteOpen(true);
  }, []);

  const isSelf = useCallback(
    (username: string) => username === currentUsername,
    [currentUsername]
  );

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

      {exhaustedCount > 0 && (
        <Alert severity="warning" className="mb-4">
          <span className="font-semibold text-red-600">
            {t('license.admin.exhausted_users', { count: exhaustedCount })}
          </span>
        </Alert>
      )}

      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {t('admin.users.total', { count: users.length })}
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <PiPlus className="mr-1" />
          {t('admin.users.create')}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-xs text-gray-500">
              <th className="px-3 py-2">{t('admin.users.email')}</th>
              <th className="px-3 py-2">{t('admin.users.status')}</th>
              <th className="px-3 py-2">{t('admin.users.enabled')}</th>
              <th className="px-3 py-2">{t('admin.users.role')}</th>
              <th className="px-3 py-2">{t('license.admin.column_header')}</th>
              <th className="px-3 py-2">{t('admin.users.created')}</th>
              <th className="px-3 py-2">{t('admin.users.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2">
                  <div>{user.email}</div>
                  {isSelf(user.username) && (
                    <span className="text-aws-smile text-xs">
                      {t('admin.users.you')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                      user.status === 'CONFIRMED'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                    {user.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {user.enabled ? (
                    <span className="text-green-600">
                      <PiCheckCircle className="inline" />{' '}
                      {t('admin.users.enabled_yes')}
                    </span>
                  ) : (
                    <span className="text-red-500">
                      <PiProhibit className="inline" />{' '}
                      {t('admin.users.enabled_no')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {user.groups.includes('admin') ? (
                    <span className="bg-aws-smile/10 text-aws-smile inline-flex rounded-full px-2 py-0.5 text-xs font-medium">
                      {t('admin.users.role_admin')}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {t('admin.users.role_user')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <UserLicenseCell
                    entry={usageByUserId.get(user.username)}
                    loaded={usageSummaryData !== undefined}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {new Date(user.createdDate).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                      title={
                        user.enabled
                          ? t('admin.users.disable')
                          : t('admin.users.enable')
                      }
                      disabled={
                        isSelf(user.username) || actionLoading === user.username
                      }
                      onClick={() => handleToggleEnabled(user)}>
                      {user.enabled ? <PiProhibit /> : <PiCheckCircle />}
                    </button>
                    <button
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                      title={t('admin.users.edit_role')}
                      disabled={isSelf(user.username)}
                      onClick={() => openGroupsDialog(user)}>
                      <PiUserGear />
                    </button>
                    <button
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                      title={t('license.admin.assign_action')}
                      onClick={() => setAssigningUser(user)}>
                      <PiCreditCard />
                    </button>
                    <button
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                      title={t('admin.users.reset_mfa')}
                      disabled={
                        isSelf(user.username) || actionLoading === user.username
                      }
                      onClick={() => openResetMfaDialog(user)}>
                      <PiShieldSlash />
                    </button>
                    <button
                      className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      title={t('admin.users.delete')}
                      disabled={isSelf(user.username)}
                      onClick={() => openDeleteDialog(user)}>
                      <PiTrash />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create User Dialog */}
      <ModalDialog
        isOpen={isCreateOpen}
        title={t('admin.users.create_title')}
        onClose={() => {
          setIsCreateOpen(false);
          setCreateError('');
        }}>
        <div className="space-y-4">
          {createError && <Alert severity="error">{createError}</Alert>}
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t('admin.users.email')}
            </label>
            <input
              type="email"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none focus:ring-0"
              placeholder={t('admin.users.email_placeholder')}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newIsAdmin}
                onChange={(e) => setNewIsAdmin(e.target.checked)}
                className="rounded"
              />
              {t('admin.users.grant_admin')}
            </label>
          </div>
          <div className="text-xs text-gray-500">
            {t('admin.users.create_note')}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              outlined
              onClick={() => {
                setIsCreateOpen(false);
                setCreateError('');
              }}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              loading={createLoading}
              disabled={!newEmail.trim()}>
              {t('admin.users.create')}
            </Button>
          </div>
        </div>
      </ModalDialog>

      {/* Edit Groups Dialog */}
      <ModalDialog
        isOpen={isGroupsOpen}
        title={t('admin.users.edit_role_title')}
        onClose={() => setIsGroupsOpen(false)}>
        <div className="space-y-4">
          <div className="text-sm">
            {t('admin.users.editing_user', { email: editingUser?.email })}
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editingIsAdmin}
                onChange={(e) => setEditingIsAdmin(e.target.checked)}
                className="rounded"
              />
              {t('admin.users.admin_role')}
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button outlined onClick={() => setIsGroupsOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdateGroups} loading={groupsLoading}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </ModalDialog>

      {/* Delete Confirm Dialog */}
      <ModalDialog
        isOpen={isDeleteOpen}
        title={t('admin.users.delete_confirm_title')}
        onClose={() => setIsDeleteOpen(false)}>
        <div className="space-y-4">
          <div className="text-sm">
            {t('admin.users.delete_confirm', {
              email: deletingUser?.email,
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button outlined onClick={() => setIsDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleDelete}
              loading={deleteLoading}
              className="bg-red-500 text-white">
              {t('admin.users.delete')}
            </Button>
          </div>
        </div>
      </ModalDialog>

      {/* Reset MFA Confirm Dialog */}
      <ModalDialog
        isOpen={isResetMfaOpen}
        title={t('admin.users.reset_mfa_confirm_title')}
        onClose={() => setIsResetMfaOpen(false)}>
        <div className="space-y-4">
          <div className="text-sm">
            {t('admin.users.reset_mfa_confirm', {
              email: resetMfaUser?.email,
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button outlined onClick={() => setIsResetMfaOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleResetMfa} loading={resetMfaLoading}>
              {t('admin.users.reset_mfa')}
            </Button>
          </div>
        </div>
      </ModalDialog>

      {/* Assign License Dialog */}
      {assigningUser && (
        <AssignLicenseDialog
          key={assigningUser.username}
          user={assigningUser}
          plans={enabledPlans}
          onClose={() => setAssigningUser(null)}
          onAssigned={() => mutateUsageSummary()}
        />
      )}
    </div>
  );
};

export default UserManagement;
