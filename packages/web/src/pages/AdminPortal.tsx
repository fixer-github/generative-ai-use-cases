import React, { useState, useEffect } from 'react';
import { useAuthenticator } from '@aws-amplify/ui-react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { PiUsers, PiUserPlus, PiShieldCheck } from 'react-icons/pi';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingOverlay from '../components/LoadingOverlay';
import UserInviteDialog from '../components/UserInviteDialog';
import useHttp from '../hooks/useHttp';

interface AdminStatusResponse {
  isAdmin: boolean;
  tenantId: string;
  username: string;
}

interface TenantUser {
  username: string;
  email: string;
  tenantId: string;
  tenantAdmin: boolean;
  enabled: boolean;
  userStatus: string;
  createdDate: string;
  lastModifiedDate: string;
}

const AdminPortal: React.FC = () => {
  const { user: _user } = useAuthenticator();
  const { t: _t } = useTranslation();
  const { api } = useHttp();
  
  const [adminStatus, setAdminStatus] = useState<AdminStatusResponse | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteDialog, setShowInviteDialog] = useState(false);

  // Check admin status on component mount
  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const response = await api.get('/admin/status');
        setAdminStatus(response.data);
        
        if (response.data.isAdmin) {
          await loadUsers();
        }
      } catch (error: any) {
        console.error('Failed to check admin status:', error);
        setError('Failed to verify admin status');
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [api]);

  const loadUsers = async () => {
    try {
      const response = await api.get('/admin/users');
      setUsers(response.data.users || []);
    } catch (error: any) {
      console.error('Failed to load users:', error);
      setError('Failed to load users');
    }
  };

  const handleRoleChange = async (username: string, isAdmin: boolean) => {
    try {
      await api.put(`/admin/users/${username}/role`, {
        username,
        tenantAdmin: isAdmin,
      });
      
      // Reload users to reflect changes
      await loadUsers();
    } catch (error: any) {
      console.error('Failed to update user role:', error);
      setError('Failed to update user role');
    }
  };

  const handleRemoveUser = async (username: string) => {
    if (!confirm(`Are you sure you want to remove user ${username}? This action cannot be undone.`)) {
      return;
    }

    try {
      await api.delete(`/admin/users/${username}`, {
        data: { username, action: 'disable' }, // Default to disable instead of delete
      });
      
      // Reload users to reflect changes
      await loadUsers();
    } catch (error: any) {
      console.error('Failed to remove user:', error);
      setError('Failed to remove user');
    }
  };

  // Redirect if not admin
  if (!loading && (!adminStatus || !adminStatus.isAdmin)) {
    return <Navigate to="/settings" replace />;
  }

  if (loading) {
    return <LoadingOverlay>Loading...</LoadingOverlay>;
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 xl:px-12 2xl:px-32">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                <PiShieldCheck className="mr-3 inline text-3xl text-blue-600" />
                Admin Portal
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                Manage users for tenant: <span className="font-semibold">{adminStatus?.tenantId}</span>
              </p>
            </div>
            <div className="flex space-x-3">
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={() => setShowInviteDialog(true)}
              >
                <PiUserPlus className="mr-2" />
                Invite Users
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6">
            <Alert severity="error" className="w-full">
              {error}
            </Alert>
          </div>
        )}

        {/* Stats Cards */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <PiUsers className="h-8 w-8 text-blue-600" />
              <div className="ml-4">
                <div className="text-2xl font-semibold text-gray-900">{users.length}</div>
                <div className="text-sm text-gray-600">Total Users</div>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <PiShieldCheck className="h-8 w-8 text-green-600" />
              <div className="ml-4">
                <div className="text-2xl font-semibold text-gray-900">
                  {users.filter(u => u.tenantAdmin).length}
                </div>
                <div className="text-sm text-gray-600">Admins</div>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <PiUsers className="h-8 w-8 text-gray-600" />
              <div className="ml-4">
                <div className="text-2xl font-semibold text-gray-900">
                  {users.filter(u => !u.tenantAdmin).length}
                </div>
                <div className="text-sm text-gray-600">Regular Users</div>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow border">
            <div className="flex items-center">
              <PiUsers className="h-8 w-8 text-red-600" />
              <div className="ml-4">
                <div className="text-2xl font-semibold text-gray-900">
                  {users.filter(u => !u.enabled).length}
                </div>
                <div className="text-sm text-gray-600">Disabled Users</div>
              </div>
            </div>
          </div>
        </div>

        {/* User Management Table */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">User Management</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.username} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{user.email}</div>
                        <div className="text-sm text-gray-500">{user.username}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={user.tenantAdmin ? 'admin' : 'user'}
                        onChange={(e) => handleRoleChange(user.username, e.target.value === 'admin')}
                        disabled={user.username === adminStatus?.username}
                        className="text-sm rounded border border-gray-300 px-2 py-1 disabled:bg-gray-100 disabled:cursor-not-allowed"
                      >
                        <option value="user">Regular User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 text-xs font-semibold rounded-full ${
                        user.enabled 
                          ? user.userStatus === 'CONFIRMED' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {user.enabled ? user.userStatus : 'DISABLED'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(user.createdDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      {user.username !== adminStatus?.username && (
                        <Button
                          outlined={true}
                          className="text-red-600 hover:text-red-700 border-red-300 hover:border-red-400"
                          onClick={() => handleRemoveUser(user.username)}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                      No users found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <UserInviteDialog 
          isOpen={showInviteDialog}
          onClose={() => setShowInviteDialog(false)}
          onInviteSuccess={loadUsers}
        />
      </div>
    </div>
  );
};

export default AdminPortal;