import React, { useCallback, useEffect, useMemo } from 'react';
import ButtonSend from './ButtonSend';
import ButtonToggle from './ButtonToggle';
import Textarea from './Textarea';
import ZoomUpImage from './ZoomUpImage';
import ZoomUpVideo from './ZoomUpVideo';
import useChat from '../hooks/useChat';
import { useLocation } from 'react-router-dom';
import Button from './Button';
import ButtonIcon from './ButtonIcon';
import {
  PiArrowsCounterClockwise,
  PiPaperclip,
  PiSpinnerGap,
  PiSlidersHorizontal,
  PiClockCountdownLight,
  PiGlobe,
} from 'react-icons/pi';
import useFiles from '../hooks/useFiles';
import FileCard from './FileCard';
import { FileLimit } from 'generative-ai-use-cases';
import { useTranslation } from 'react-i18next';
import useUserSetting from '../hooks/useUserSetting';
import useLicense from '../hooks/useLicense';
import Tooltip from './Tooltip';

type Props = {
  content: string;
  disabled?: boolean;
  placeholder?: string;
  description?: string;
  fullWidth?: boolean;
  resetDisabled?: boolean;
  loading?: boolean;
  isEmpty?: boolean;
  onChangeContent: (content: string) => void;
  onSend: () => void;
  sendIcon?: React.ReactNode;
  // When using it outside the bottom of the page, disable the margin bottom
  disableMarginBottom?: boolean;
  fileUpload?: boolean;
  fileLimit?: FileLimit;
  accept?: string[];
  canStop?: boolean;
  reasoning?: boolean;
  onReasoningSwitched?: () => void;
  reasoningEnabled?: boolean;
  webSearch?: boolean;
  onWebSearchSwitched?: () => void;
  webSearchEnabled?: boolean;
} & (
  | {
      hideReset?: false;
      onReset: () => void;
    }
  | {
      hideReset: true;
    }
) & {
    setting?: boolean;
    onSetting?: () => void;
  };

const InputChatContent: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const { settingSubmitCmdOrCtrlEnter } = useUserSetting();
  const { blocked, blockReason, resetDate } = useLicense();
  const { pathname } = useLocation();
  const { loading: chatLoading, isEmpty: chatIsEmpty } = useChat(pathname);
  const {
    uploadedFiles,
    uploadFiles,
    checkFiles,
    deleteUploadedFile,
    uploading,
    errorMessages,
  } = useFiles(pathname);

  // When the model is changed, etc., display the error message (do not automatically delete the file)
  useEffect(() => {
    if (props.fileLimit && props.accept) {
      checkFiles(props.fileLimit, props.accept);
    }
  }, [checkFiles, props.fileLimit, props.accept]);

  const onChangeFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && props.fileLimit && props.accept) {
      // Reflect the file and upload it
      uploadFiles(Array.from(files), props.fileLimit, props.accept);
    }
  };

  const deleteFile = useCallback(
    (fileId: string) => {
      if (props.fileLimit && props.accept) {
        deleteUploadedFile(fileId, props.fileLimit, props.accept);
      }
    },
    [deleteUploadedFile, props.fileLimit, props.accept]
  );
  const handlePaste = async (pasteEvent: React.ClipboardEvent) => {
    const fileList = pasteEvent.clipboardData.items || [];
    const files = Array.from(fileList)
      .filter((file) => file.kind === 'file')
      .map((file) => file.getAsFile() as File);
    if (files.length > 0 && props.fileLimit && props.accept) {
      // Upload the file
      uploadFiles(Array.from(files), props.fileLimit, props.accept);
      // Since the file name is also pasted when the file is pasted, stop the default behavior
      pasteEvent.preventDefault();
    }
    // If there is no file, stop the default behavior (paste text)
  };

  const loading = useMemo(() => {
    return props.loading === undefined ? chatLoading : props.loading;
  }, [chatLoading, props.loading]);

  const disabledSend = useMemo(() => {
    return (
      (!loading && props.content.trim() === '') ||
      props.disabled ||
      uploading ||
      errorMessages.length > 0
    );
  }, [props.content, props.disabled, uploading, errorMessages, loading]);

  // While the license blocks sending (unassigned or exhausted), replace the
  // input area with a guidance panel (requirements 28, 30, 31). Viewing and
  // copying past conversations stays untouched.
  if (blocked) {
    return (
      <div
        className={`${
          props.fullWidth ? 'w-full' : 'w-11/12 md:w-10/12 lg:w-4/6 xl:w-3/6'
        }`}>
        <div
          role="alert"
          className={`flex flex-col gap-1 rounded-xl border border-red-200 bg-red-50 p-4 shadow-[0_0_30px_1px] shadow-gray-400/40 ${
            props.disableMarginBottom ? '' : 'mb-7'
          }`}>
          <div className="text-base font-semibold text-red-700">
            {blockReason === 'unassigned'
              ? t('license.blocked.title_unassigned')
              : t('license.blocked.title_exhausted')}
          </div>
          <div className="text-sm text-gray-700">
            {blockReason === 'unassigned'
              ? t('license.blocked.body_unassigned')
              : t('license.blocked.body_exhausted', {
                  resetDate: resetDate ?? '',
                })}
          </div>
          <div className="text-xs text-gray-500">
            {t('license.blocked.contact')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${
        props.fullWidth ? 'w-full' : 'w-11/12 md:w-10/12 lg:w-4/6 xl:w-3/6'
      }`}>
      {props.description && (
        <p className="m-2 whitespace-pre-wrap text-xs text-gray-500">
          {props.description}
        </p>
      )}
      <div
        className={`relative flex flex-col rounded-xl border border-black/10 bg-gray-100 shadow-[0_0_30px_1px] shadow-gray-400/40 ${
          props.disableMarginBottom
            ? ''
            : settingSubmitCmdOrCtrlEnter
              ? 'mb-2'
              : 'mb-7'
        }`}>
        <div className="flex grow flex-col">
          {props.fileUpload && uploadedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 p-2">
              {uploadedFiles.map((uploadedFile, idx) => {
                if (uploadedFile.type === 'image') {
                  return (
                    <ZoomUpImage
                      key={idx}
                      src={uploadedFile.base64EncodedData}
                      loading={uploadedFile.uploading}
                      deleting={uploadedFile.deleting}
                      size="s"
                      error={uploadedFile.errorMessages.length > 0}
                      onDelete={() => {
                        deleteFile(uploadedFile.id ?? '');
                      }}
                    />
                  );
                } else if (uploadedFile.type === 'video') {
                  return (
                    <ZoomUpVideo
                      key={idx}
                      src={uploadedFile.base64EncodedData}
                      loading={uploadedFile.uploading}
                      deleting={uploadedFile.deleting}
                      size="s"
                      error={uploadedFile.errorMessages.length > 0}
                      onDelete={() => {
                        deleteFile(uploadedFile.id ?? '');
                      }}
                    />
                  );
                } else {
                  return (
                    <FileCard
                      key={idx}
                      filename={uploadedFile.name}
                      loading={uploadedFile.uploading}
                      deleting={uploadedFile.deleting}
                      size="s"
                      error={uploadedFile.errorMessages.length > 0}
                      onDelete={() => {
                        deleteFile(uploadedFile.id ?? '');
                      }}
                    />
                  );
                }
              })}
            </div>
          )}
          {errorMessages.length > 0 && (
            <div className="m-2 flex flex-wrap gap-2">
              {errorMessages.map((errorMessage, idx) => (
                <p key={idx} className="text-red-500">
                  {errorMessage}
                </p>
              ))}
            </div>
          )}
          <Textarea
            className={`scrollbar-thumb-gray-200 scrollbar-thin -mr-14 bg-transparent p-4`}
            placeholder={props.placeholder ?? t('common.enter_text')}
            noBorder
            notItem
            value={props.content}
            onChange={props.onChangeContent}
            onPaste={props.fileUpload ? handlePaste : undefined}
            onEnter={disabledSend ? undefined : props.onSend}
          />
        </div>
        <div className="m-2 flex justify-between gap-1">
          <div className="flex gap-x-1">
            {props.fileUpload && (
              <Tooltip
                message={t('inputs.attachment')}
                position="center"
                topPosition="-top-16"
                nowrap>
                <div className="">
                  <label>
                    <input
                      hidden
                      onChange={onChangeFiles}
                      type="file"
                      accept={props.accept?.join(',')}
                      multiple
                      value={[]}
                    />
                    <div
                      className={`${
                        uploading
                          ? 'border-gray-400 bg-gray-300 text-gray-400'
                          : uploadedFiles.length > 0
                            ? 'bg-aws-smile border-aws-smile cursor-pointer text-white'
                            : 'cursor-pointer border-gray-400 bg-white text-gray-400'
                      } flex items-center justify-center rounded-xl border p-2 align-bottom text-xl`}>
                      {uploading ? (
                        <PiSpinnerGap className="animate-spin" />
                      ) : (
                        <PiPaperclip />
                      )}
                    </div>
                  </label>
                </div>
              </Tooltip>
            )}
            {props.reasoning && (
              <Tooltip
                message={t('inputs.reasoning')}
                position="center"
                topPosition="-top-16"
                nowrap>
                <ButtonToggle
                  onSwitch={props.onReasoningSwitched ?? (() => {})}
                  icon={<PiClockCountdownLight />}
                  isEnabled={!!props.reasoningEnabled}
                />
              </Tooltip>
            )}
            {props.webSearch && (
              <Tooltip
                message={t('inputs.web_search')}
                position="center"
                topPosition="-top-16"
                nowrap>
                <ButtonToggle
                  onSwitch={props.onWebSearchSwitched ?? (() => {})}
                  icon={<PiGlobe />}
                  isEnabled={!!props.webSearchEnabled}
                />
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-x-2">
            {props.setting && (
              <Tooltip
                message={t('inputs.setting')}
                position="center"
                topPosition="-top-16"
                nowrap>
                <ButtonIcon
                  onClick={props.onSetting ?? (() => {})}
                  className="text-gray-500">
                  <PiSlidersHorizontal />
                </ButtonIcon>
              </Tooltip>
            )}
            <ButtonSend
              className=""
              disabled={disabledSend}
              loading={loading || uploading}
              onClick={props.onSend}
              icon={props.sendIcon}
              canStop={props.canStop}
            />
          </div>
        </div>

        {!(props.isEmpty ?? chatIsEmpty) &&
          !props.resetDisabled &&
          !props.hideReset && (
            <Button
              className="absolute -top-14 right-0 p-2 text-sm"
              outlined
              disabled={loading}
              onClick={props.onReset}>
              <PiArrowsCounterClockwise className="mr-2" />
              {t('common.start_over')}
            </Button>
          )}
      </div>

      {/* Show keyboard shortcut hint when cmd/ctrl+enter setting is enabled */}
      {settingSubmitCmdOrCtrlEnter && (
        <div className="mb-2 text-right text-xs text-gray-500">
          {navigator.platform.toLowerCase().includes('mac')
            ? t('chat.hint_cmd_enter')
            : t('chat.hint_ctrl_enter')}
        </div>
      )}
    </div>
  );
};

export default InputChatContent;
