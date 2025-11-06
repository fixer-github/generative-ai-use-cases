import React, { useCallback, useEffect, useState } from 'react';
import ButtonIcon from '@/components/ui/ButtonIcon';
import { BaseProps } from '@/@types/common';
import { PiCheck, PiClipboard } from 'react-icons/pi';
import copy from 'copy-to-clipboard';
import useInterUseCases from '@/hooks/useInterUseCases';

type Props = BaseProps & {
  text: string;
  html?: string;
  interUseCasesKey?: string;
  disabled?: boolean;
};

const ButtonCopy: React.FC<Props> = (props) => {
  const [showsCheck, setshowsCheck] = useState(false);
  const { setCopyTemporary } = useInterUseCases();

  useEffect(() => {
    if (props.interUseCasesKey) {
      setCopyTemporary(props.interUseCasesKey, props.text);
    }
  }, [props.interUseCasesKey, props.text, setCopyTemporary]);

  const copyMessage = useCallback((message: string, html?: string) => {
    // Copy both text and html
    copy(message, {
      format: 'text/plain',
      onCopy: (clipboardData) => {
        if (html && clipboardData) {
          // TypeScript doesn't recognize setData method on the object type from copy-to-clipboard
          // but it's actually a DataTransfer object at runtime
          (clipboardData as DataTransfer).setData('text/html', html);
        }
      },
    });
    setshowsCheck(true);

    setTimeout(() => {
      setshowsCheck(false);
    }, 3000);
  }, []);

  return (
    <ButtonIcon
      className={`${props.className ?? ''}`}
      disabled={props.disabled}
      onClick={() => {
        copyMessage(props.text, props.html);
      }}>
      {showsCheck ? <PiCheck /> : <PiClipboard />}
    </ButtonIcon>
  );
};

export default ButtonCopy;
