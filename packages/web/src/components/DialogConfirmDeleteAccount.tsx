import React, { useState, useEffect } from 'react';
import { BaseProps } from '../@types/common';
import Button from './Button';
import ModalDialog from './ModalDialog';
import { useTranslation } from 'react-i18next';

type Props = BaseProps & {
  isOpen: boolean;
  userEmail: string;
  onDelete: () => void;
  onClose: () => void;
  isDeleting?: boolean;
};

const DialogConfirmDeleteAccount: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const [emailInput, setEmailInput] = useState('');
  const [deleteInput, setDeleteInput] = useState('');

  // Reset inputs when dialog opens/closes
  useEffect(() => {
    if (!props.isOpen) {
      setEmailInput('');
      setDeleteInput('');
    }
  }, [props.isOpen]);

  const isValid = emailInput === props.userEmail && deleteInput === 'DELETE';

  return (
    <ModalDialog
      {...props}
      title={t('settings.deleteAccountConfirmTitle')}
      onClose={props.onClose}>
      <div className="space-y-4">
        <p className="text-gray-600">
          {t('settings.deleteAccountConfirmDescription')}
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('settings.deleteAccountEmailLabel')}
            </label>
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder={props.userEmail}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              disabled={props.isDeleting}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('settings.deleteAccountDeleteLabel')}
            </label>
            <input
              type="text"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              disabled={props.isDeleting}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button
            outlined
            onClick={props.onClose}
            className="p-2"
            disabled={props.isDeleting}>
            {t('settings.deleteAccountCancel')}
          </Button>
          <Button
            onClick={props.onDelete}
            className="bg-red-600 p-2 text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
            disabled={!isValid || props.isDeleting}>
            {props.isDeleting
              ? t('common.loading')
              : t('settings.deleteAccountConfirm')}
          </Button>
        </div>
      </div>
    </ModalDialog>
  );
};

export default DialogConfirmDeleteAccount;
