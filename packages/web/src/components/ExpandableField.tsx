import React, { useMemo, useState } from 'react';
import RowItem, { RowItemProps } from './RowItem';
import { PiCaretRightFill } from 'react-icons/pi';
import { useTranslation } from 'react-i18next';

type Props = RowItemProps & {
  label: string;
  defaultOpened?: boolean;
  optional?: boolean;
  children: React.ReactNode;
  // If you want to control the toggle state from the parent component
  overrideExpanded?: boolean;
  setOverrideExpanded?: (overrideExpanded: boolean) => void;
};

const ExpandableField: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(props.defaultOpened ?? false);

  // To correspond to the override of the toggle state, take the or of expanded and overrideExpanded
  const expandState = useMemo(
    () => expanded || props.overrideExpanded,
    [expanded, props.overrideExpanded]
  );

  return (
    <RowItem notItem={props.notItem} className={props.className}>
      <div
        className="mb-2 flex cursor-pointer items-center text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors"
        onClick={() => {
          setExpanded(!expandState);
          if (props.setOverrideExpanded) {
            props.setOverrideExpanded(!expandState);
          }
        }}>
        <PiCaretRightFill
          className={`mr-2 text-gray-500 ${expandState && 'rotate-90'} transition-transform`}
        />
        {props.label}
        {props.optional && (
          <>
            <span className="ml-2 text-xs font-normal italic text-gray-500">
              ({t('common.optional')})
            </span>
          </>
        )}
      </div>

      {expandState && <div className="ml-6">{props.children}</div>}
    </RowItem>
  );
};

export default ExpandableField;
