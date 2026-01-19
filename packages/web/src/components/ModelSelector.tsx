import React, { useState, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { PiCaretDown, PiCheck, PiCaretRight } from 'react-icons/pi';
import { useTranslation } from 'react-i18next';

export type ModelOption = {
  value: string;
  label: string;
  description?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  models: ModelOption[];
  featuredModelIds: string[];
  className?: string;
};

const ModelSelector: React.FC<Props> = ({
  value,
  onChange,
  models,
  featuredModelIds,
  className = '',
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isSubMenuOpen, setIsSubMenuOpen] = useState(false);

  const currentModel = useMemo(() => {
    return models.find((m) => m.value === value);
  }, [models, value]);

  const { featuredModels, otherModels } = useMemo(() => {
    const featured: ModelOption[] = [];
    const others: ModelOption[] = [];

    models.forEach((model) => {
      if (featuredModelIds.includes(model.value)) {
        featured.push(model);
      } else {
        others.push(model);
      }
    });

    featured.sort((a, b) => {
      const indexA = featuredModelIds.indexOf(a.value);
      const indexB = featuredModelIds.indexOf(b.value);
      return indexA - indexB;
    });

    return { featuredModels: featured, otherModels: others };
  }, [models, featuredModelIds]);

  const displayFeaturedModels = useMemo(() => {
    if (value && !featuredModelIds.includes(value)) {
      const selectedModel = models.find((m) => m.value === value);
      if (selectedModel) {
        return [selectedModel, ...featuredModels];
      }
    }
    return featuredModels;
  }, [value, featuredModelIds, models, featuredModels]);

  const handleSelect = (modelValue: string) => {
    onChange(modelValue);
    setIsSubMenuOpen(false);
    setOpen(false);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen);
        if (!isOpen) {
          setIsSubMenuOpen(false);
        }
      }}>
      <Popover.Trigger asChild>
        <button
          className={`relative h-10 w-full cursor-pointer rounded-lg px-4 py-2 text-left focus:outline-none ${className}`}>
          <span className="flex items-center justify-between">
            <span className="block truncate font-medium">
              {currentModel?.label || value}
            </span>
            <PiCaretDown className="ml-2 h-5 w-5 text-gray-400" />
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-80 rounded-lg bg-white shadow-lg ring-1 ring-black/5 focus:outline-none">
          <div className="py-1">
            {/* Featured Models */}
            {displayFeaturedModels.map((model) => (
              <button
                key={model.value}
                onClick={() => handleSelect(model.value)}
                className="group flex w-full items-start px-4 py-3 text-left hover:bg-gray-100">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {value === model.value && (
                    <PiCheck className="text-aws-smile h-5 w-5" />
                  )}
                </span>
                <div className="ml-3 flex-1">
                  <div className="font-medium text-gray-900">{model.label}</div>
                  {model.description && (
                    <div className="mt-0.5 text-sm text-gray-500">
                      {model.description}
                    </div>
                  )}
                </div>
              </button>
            ))}

            {/* Separator */}
            {displayFeaturedModels.length > 0 && otherModels.length > 0 && (
              <div className="my-1 border-t border-gray-200" />
            )}

            {/* Other Models with Submenu */}
            {otherModels.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setIsSubMenuOpen(!isSubMenuOpen)}
                  className="group flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left hover:bg-gray-100">
                  <span className="font-medium text-gray-900">
                    {t('model.otherModels')}
                  </span>
                  <PiCaretRight className="h-5 w-5 text-gray-400" />
                </button>

                {/* Submenu */}
                {isSubMenuOpen && (
                  <div className="absolute left-full top-0 ml-2 w-80 rounded-lg bg-white shadow-lg ring-1 ring-black/5">
                    <div className="max-h-96 overflow-y-auto py-1">
                      {otherModels.map((model) => (
                        <button
                          key={model.value}
                          onClick={() => handleSelect(model.value)}
                          className="group flex w-full items-start px-4 py-3 text-left hover:bg-gray-100">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                            {value === model.value && (
                              <PiCheck className="text-aws-smile h-5 w-5" />
                            )}
                          </span>
                          <div className="ml-3 flex-1">
                            <div className="font-medium text-gray-900">
                              {model.label}
                            </div>
                            {model.description && (
                              <div className="mt-0.5 text-sm text-gray-500">
                                {model.description}
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default ModelSelector;
