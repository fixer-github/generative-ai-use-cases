import React, { useState } from 'react';
import { BaseProps } from '@/@types/common';
import { useTranslation } from 'react-i18next';

type Props = BaseProps & {
  onUpload: (files: File[]) => void;
  fileLimit?: number;
  accept?: string;
  message?: string;
  enabled?: boolean;
  children: React.ReactNode;
};

const FileDropZone: React.FC<Props> = ({
  onUpload,
  fileLimit,
  accept,
  message,
  enabled = true,
  children,
  className,
}) => {
  const { t } = useTranslation();
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (event: React.DragEvent) => {
    if (!enabled) return;
    event.preventDefault();
    setIsOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setIsOver(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsOver(false);

    if (!enabled) return;

    if (event.dataTransfer.files) {
      const files = Array.from(event.dataTransfer.files);

      // Filter by accept type if specified
      const filteredFiles = accept
        ? files.filter((file) => {
            const acceptTypes = accept.split(',').map((type) => type.trim());
            return acceptTypes.some((type) => {
              if (type.startsWith('.')) {
                return file.name.endsWith(type);
              }
              return file.type.match(type.replace('*', '.*'));
            });
          })
        : files;

      // Limit number of files if specified
      const limitedFiles = fileLimit
        ? filteredFiles.slice(0, fileLimit)
        : filteredFiles;

      if (limitedFiles.length > 0) {
        onUpload(limitedFiles);
      }
    }
  };

  return (
    <div
      onDragOver={enabled ? handleDragOver : undefined}
      className={className}>
      {isOver && enabled && (
        <div
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-300/90 p-10 outline-dashed">
          <p className="text-xl font-bold">
            {message || t('common.drop_files')}
          </p>
        </div>
      )}
      {children}
    </div>
  );
};

export default FileDropZone;
