import React from 'react';
import { PiPencilLine } from 'react-icons/pi';
import { useNavigate } from 'react-router-dom';
import { BaseProps } from '../../@types/common';
import ButtonIcon from '../ButtonIcon';

type Props = BaseProps & {
  useCaseId: string;
};

const ButtonUseCaseEdit: React.FC<Props> = (props) => {
  const navigate = useNavigate();
  return (
    <ButtonIcon
      className={props.className ?? ''}
      onClick={() => {
        navigate(`/use-case-builder/edit/${props.useCaseId}`);
      }}
    >
      <PiPencilLine />
    </ButtonIcon>
  );
};

export default ButtonUseCaseEdit;
