import React, { useMemo } from 'react';
import { BaseProps } from '../@types/common';
import { PiGear } from 'react-icons/pi';
import SidebarItem, { SidebarItemProps as SidebarItemBaseProps } from './SidebarItem';
import { useTranslation } from 'react-i18next';
import useVersion from '../hooks/useVersion';
import IconWithDot from './IconWithDot';

export type SidebarItemProps = SidebarItemBaseProps & {
  display: 'usecase' | 'tool' | 'none';
};

type Props = BaseProps & {
  items: SidebarItemProps[];
};

const Sidebar: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const { getHasUpdate } = useVersion();

  // Filter items by display type
  const allItems = useMemo(() => {
    return props.items.filter((i) => i.display !== 'none');
  }, [props.items]);

  const hasUpdate = getHasUpdate();

  return (
    <nav className="bg-aws-squid-ink flex h-screen w-24 flex-col text-sm text-white">
      <div className="scrollbar-thin scrollbar-thumb-white flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-1">
          {allItems.map((item, idx) => (
            <SidebarItem
              key={idx}
              label={item.label}
              icon={item.icon}
              to={item.to}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-gray-600 p-2">
        <div className="flex flex-col gap-1">
          <div className="relative">
            <SidebarItem
              label={t('navigation.settings')}
              icon={<PiGear />}
              to="/setting"
            />
            {hasUpdate && (
              <div className="absolute right-3 top-2">
                <IconWithDot showDot={hasUpdate}>
                  <div />
                </IconWithDot>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Sidebar;
