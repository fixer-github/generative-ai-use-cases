import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PiUsers, PiLock, PiCreditCard } from 'react-icons/pi';
import useAdmin from '../../hooks/useAdmin';
import Alert from '../../components/Alert';
import UserManagement from './UserManagement';
import PasswordPolicySettings from './PasswordPolicySettings';
import LicenseManagement from './LicenseManagement';

type Tab = 'users' | 'passwordPolicy' | 'license';

const AdminPage: React.FC = () => {
  const { t } = useTranslation();
  const { isAdmin } = useAdmin();
  const [activeTab, setActiveTab] = useState<Tab>('users');

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <Alert severity="error" title={t('admin.access_denied')}>
          {t('admin.access_denied_message')}
        </Alert>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'users',
      label: t('admin.tabs.user_management'),
      icon: <PiUsers className="mr-1.5" />,
    },
    {
      key: 'passwordPolicy',
      label: t('admin.tabs.password_policy'),
      icon: <PiLock className="mr-1.5" />,
    },
    {
      key: 'license',
      label: t('admin.tabs.license'),
      icon: <PiCreditCard className="mr-1.5" />,
    },
  ];

  return (
    <div className="px-4 pb-8 lg:px-12 xl:px-24">
      <div className="my-4 flex justify-center text-lg font-semibold">
        {t('admin.title')}
      </div>

      <div className="mb-4 flex border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`flex items-center px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-aws-smile text-aws-smile border-b-2'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab(tab.key)}>
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && <UserManagement />}
      {activeTab === 'passwordPolicy' && <PasswordPolicySettings />}
      {activeTab === 'license' && <LicenseManagement />}
    </div>
  );
};

export default AdminPage;
