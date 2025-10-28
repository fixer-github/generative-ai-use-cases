import React, { useMemo } from 'react';
import { BaseProps } from '../@types/common';
import { PiChartBar, PiGear } from 'react-icons/pi';
import DrawerItem, { DrawerItemProps } from './DrawerItem';
import DrawerBase from './DrawerBase';
import { useTranslation } from 'react-i18next';
import useVersion from '../hooks/useVersion';
import IconWithDot from './IconWithDot';

export type ItemProps = DrawerItemProps & {
  display: 'usecase' | 'tool' | 'none';
};

type Props = BaseProps & {
  items: ItemProps[];
};

const Drawer: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const { getHasUpdate } = useVersion();

  // Filter items by display type
  const allItems = useMemo(() => {
    return props.items.filter((i) => i.display !== 'none');
  }, [props.items]);

  const hasUpdate = getHasUpdate();

  return (
    <DrawerBase>
      <div className="scrollbar-thin scrollbar-thumb-white flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-1">
          {allItems.map((item, idx) => (
            <DrawerItem
              key={idx}
              label={item.label}
              icon={item.icon}
              to={item.to}
              sub={item.sub}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-gray-600 p-2">
        <div className="flex flex-col gap-1">
          <DrawerItem
            label={t('stat.title')}
            icon={<PiChartBar />}
            to="/stats"
          />
          <div className="relative">
            <DrawerItem
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
    </DrawerBase>
  );
};

export default Drawer;
