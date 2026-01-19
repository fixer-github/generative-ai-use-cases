import { useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from './ui/Dialog';
import { BaseProps } from '../@types/common';
import Help from './Help';

type Props = BaseProps & {
  isOpen: boolean;
  title: string;
  children: React.ReactNode;
  onClose?: () => void;
  help?: string;
};

const ModalDialog: React.FC<Props> = (props) => {
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open && props.onClose) {
        props.onClose();
      }
    },
    [props]
  );

  return (
    <Dialog open={props.isOpen} onOpenChange={onOpenChange}>
      <DialogContent className={props.className} hideCloseButton>
        <DialogTitle className="flex items-center">
          {props.title}
          {props.help && <Help className="ml-2" message={props.help} />}
        </DialogTitle>
        <div className="text-aws-font-color/70 text-sm">{props.children}</div>
      </DialogContent>
    </Dialog>
  );
};

export default ModalDialog;
