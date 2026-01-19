import React, { useCallback, useMemo } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { PiCaretUpDown, PiCheck, PiX } from 'react-icons/pi';
import RowItem, { RowItemProps } from './RowItem';
import ButtonIcon from './ButtonIcon';
import Help from './Help';
import { cn } from '../lib/utils';

type Props = RowItemProps & {
  label?: string;
  value: string;
  options: {
    value: string;
    label: string;
  }[];
  help?: string;
  clearable?: boolean;
  fullWidth?: boolean;
  showColorChips?: boolean;
  onChange: (value: string) => void;
};

const Select: React.FC<Props> = (props) => {
  const selectedLabel = useMemo(() => {
    if (!props.value || props.value === '') return '';
    const selectedOption = props.options.find((o) => o.value === props.value);
    if (!selectedOption) return '';
    return selectedOption.label;
  }, [props.options, props.value]);

  const onClear = useCallback(() => {
    props.onChange('');
  }, [props]);

  const ColorChips: React.FC<{ colors: string[] }> = ({ colors }) => (
    <div className="flex items-center gap-1">
      {colors.map((color, index) => (
        <div
          key={index}
          className="h-4 w-4 border border-gray-300"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );

  const OptionContent: React.FC<{ value: string; label: string }> = ({
    value,
    label,
  }) => {
    if (!props.showColorChips) return <>{label}</>;

    const colors = value.split(',').map((color) => color.trim());
    return (
      <div className="flex items-center gap-2">
        <ColorChips colors={colors} />
        <span>{label}</span>
      </div>
    );
  };

  return (
    <RowItem notItem={props.notItem} className="relative">
      {props.label && (
        <div className="flex items-center">
          <span className="text-sm">{props.label}</span>
          {props.help && <Help className="ml-1" message={props.help} />}
        </div>
      )}
      <div className="relative">
        <SelectPrimitive.Root value={props.value} onValueChange={props.onChange}>
          <SelectPrimitive.Trigger
            className={cn(
              'relative flex h-8 cursor-pointer items-center rounded border border-black/30 bg-white pl-3 pr-10 text-left focus:outline-none',
              props.fullWidth ? 'w-full' : 'w-fit'
            )}>
            <SelectPrimitive.Value>
              {props.value && (
                <span className="line-clamp-1">
                  <OptionContent value={props.value} label={selectedLabel} />
                </span>
              )}
            </SelectPrimitive.Value>
            <SelectPrimitive.Icon className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <PiCaretUpDown className="text-sm" />
            </SelectPrimitive.Icon>
          </SelectPrimitive.Trigger>

          <SelectPrimitive.Portal>
            <SelectPrimitive.Content
              position="popper"
              className="z-50 mt-1 max-h-60 w-fit min-w-64 overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm">
              <SelectPrimitive.Viewport>
                {props.options.map((option, idx) => (
                  <SelectPrimitive.Item
                    key={idx}
                    value={option.value}
                    className="relative cursor-pointer select-none py-2 pl-10 pr-4 outline-none data-[highlighted]:bg-aws-smile/10 data-[highlighted]:text-aws-smile">
                    <SelectPrimitive.ItemText>
                      <span
                        className={cn(
                          'line-clamp-1',
                          props.value === option.value
                            ? 'font-medium'
                            : 'font-normal'
                        )}>
                        <OptionContent
                          value={option.value}
                          label={option.label}
                        />
                      </span>
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="text-aws-smile absolute inset-y-0 left-0 flex items-center pl-3">
                      <PiCheck className="size-5" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Viewport>
            </SelectPrimitive.Content>
          </SelectPrimitive.Portal>
        </SelectPrimitive.Root>

        {props.clearable && props.value !== '' && (
          <span className="absolute inset-y-0 right-3 flex items-center pr-2">
            <ButtonIcon onClick={onClear}>
              <PiX className="text-sm" />
            </ButtonIcon>
          </span>
        )}
      </div>
    </RowItem>
  );
};

export default Select;
