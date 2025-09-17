import React, { useState } from 'react';
import { PiX, PiUserPlus, PiEnvelope, PiUpload } from 'react-icons/pi';
import Button from './Button';
import InputText from './InputText';
import Textarea from './Textarea';
import Alert from './Alert';
import LoadingWave from './LoadingWave';
import useHttp from '../hooks/useHttp';

interface UserInviteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onInviteSuccess?: () => void;
}

interface InviteResult {
  email: string;
  success: boolean;
  username?: string;
  temporaryPassword?: string;
  error?: string;
}

interface InviteResponse {
  results: InviteResult[];
  summary: {
    totalRequested: number;
    successful: number;
    failed: number;
  };
}

const UserInviteDialog: React.FC<UserInviteDialogProps> = ({
  isOpen,
  onClose,
  onInviteSuccess,
}) => {
  const { api } = useHttp();
  
  const [inviteMode, setInviteMode] = useState<'single' | 'bulk'>('single');
  const [singleEmail, setSingleEmail] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [sendEmail, setSendEmail] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<InviteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setSingleEmail('');
    setBulkEmails('');
    setCsvFile(null);
    setSendEmail(false);
    setResults(null);
    setError(null);
    onClose();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setCsvFile(file);
      setBulkEmails(''); // Clear manual input when file is selected
    } else {
      alert('Please select a valid CSV file');
    }
  };

  const parseCSV = (csvContent: string): string[] => {
    const lines = csvContent.trim().split('\n');
    const emails: string[] = [];
    
    // Skip header line if it contains 'email'
    const startIndex = lines[0]?.toLowerCase().includes('email') ? 1 : 0;
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        // Handle CSV with commas, quotes, etc.
        const email = line.split(',')[0].replace(/"/g, '').trim();
        if (email && email.includes('@')) {
          emails.push(email);
        }
      }
    }
    
    return emails;
  };

  const getEmailsToInvite = async (): Promise<string[]> => {
    if (inviteMode === 'single') {
      return singleEmail ? [singleEmail.trim()] : [];
    }
    
    // Bulk mode
    if (csvFile) {
      const csvContent = await csvFile.text();
      return parseCSV(csvContent);
    }
    
    if (bulkEmails) {
      return bulkEmails
        .split('\n')
        .map(email => email.trim())
        .filter(email => email && email.includes('@'));
    }
    
    return [];
  };

  const handleInvite = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const emails = await getEmailsToInvite();
      
      if (emails.length === 0) {
        setError('Please provide at least one email address');
        setLoading(false);
        return;
      }

      if (emails.length > 100) {
        setError('Maximum 100 users can be invited at once');
        setLoading(false);
        return;
      }

      const response = await api.post('/admin/users/invite', {
        emails,
        sendEmail,
      });

      setResults(response.data);
      
      if (onInviteSuccess) {
        onInviteSuccess();
      }
    } catch (error: any) {
      console.error('Failed to invite users:', error);
      setError(error.response?.data?.message || 'Failed to invite users');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-end justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleClose} />
        
        <div className="inline-block w-full max-w-2xl transform overflow-hidden rounded-lg bg-white px-4 pt-5 pb-4 text-left align-bottom shadow-xl transition-all sm:my-8 sm:p-6 sm:align-middle">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <PiUserPlus className="mr-3 text-2xl text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">
                Invite Users
              </h3>
            </div>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <PiX className="h-6 w-6" />
            </button>
          </div>

          {/* Mode Selection */}
          <div className="mb-6">
            <div className="flex rounded-lg border border-gray-300 p-1">
              <button
                className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
                  inviteMode === 'single'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setInviteMode('single')}
              >
                <PiEnvelope className="mr-2 inline" />
                Single User
              </button>
              <button
                className={`flex-1 rounded-md px-4 py-2 text-sm font-medium ${
                  inviteMode === 'bulk'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setInviteMode('bulk')}
              >
                <PiUpload className="mr-2 inline" />
                Bulk Invite
              </button>
            </div>
          </div>

          {/* Single User Mode */}
          {inviteMode === 'single' && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <InputText
                value={singleEmail}
                onChange={setSingleEmail}
                placeholder="user@example.com"
                className="w-full"
              />
            </div>
          )}

          {/* Bulk Mode */}
          {inviteMode === 'bulk' && (
            <div className="mb-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CSV File Upload
                </label>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {csvFile && (
                  <p className="mt-2 text-sm text-green-600">
                    Selected: {csvFile.name}
                  </p>
                )}
                <p className="mt-2 text-sm text-gray-500">
                  CSV format: First column should contain email addresses
                </p>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-white px-2 text-gray-500">or</span>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Manual Entry (one email per line)
                </label>
                <Textarea
                  value={bulkEmails}
                  onChange={setBulkEmails}
                  placeholder="user1@example.com&#10;user2@example.com&#10;user3@example.com"
                  rows={6}
                  className="w-full"
                  disabled={!!csvFile}
                />
              </div>
            </div>
          )}

          {/* Email Options */}
          <div className="mb-6">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm text-gray-700">
                Send invitation email automatically
              </span>
            </label>
            <p className="ml-6 text-xs text-gray-500">
              {sendEmail 
                ? 'Users will receive email with login instructions'
                : 'You will need to manually share login credentials with users'
              }
            </p>
          </div>

          {error && (
            <div className="mb-6">
              <Alert severity="error">{error}</Alert>
            </div>
          )}

          {/* Results */}
          {results && (
            <div className="mb-6">
              <div className="rounded-lg border border-gray-200 p-4">
                <h4 className="font-semibold text-gray-900 mb-3">
                  Invitation Results
                </h4>
                <div className="mb-3 text-sm text-gray-600">
                  Total: {results.summary.totalRequested} | 
                  Successful: {results.summary.successful} | 
                  Failed: {results.summary.failed}
                </div>
                
                <div className="max-h-60 overflow-y-auto">
                  {results.results.map((result, index) => (
                    <div
                      key={index}
                      className={`flex items-center justify-between p-2 rounded ${
                        result.success ? 'bg-green-50' : 'bg-red-50'
                      }`}
                    >
                      <span className="text-sm">{result.email}</span>
                      {result.success ? (
                        <span className="text-xs text-green-600">✓ Invited</span>
                      ) : (
                        <span className="text-xs text-red-600">
                          ✗ {result.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {!sendEmail && results.summary.successful > 0 && (
                  <div className="mt-3 p-3 bg-yellow-50 rounded">
                    <p className="text-sm text-yellow-800">
                      <strong>Important:</strong> Since automatic emails are disabled, 
                      you need to manually share the temporary passwords with invited users.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-3">
            <Button
              outlined={true}
              onClick={handleClose}
              disabled={loading}
            >
              {results ? 'Close' : 'Cancel'}
            </Button>
            {!results && (
              <Button
                onClick={handleInvite}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading ? (
                  <>
                    <LoadingWave />
                    Inviting...
                  </>
                ) : (
                  <>
                    <PiUserPlus className="mr-2" />
                    Send Invitations
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserInviteDialog;