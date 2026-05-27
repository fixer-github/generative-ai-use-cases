import React, { useMemo, useState } from 'react';
import { BaseProps } from '../@types/common';
import { useNavigate } from 'react-router-dom';
import { PiMagnifyingGlass, PiGear } from 'react-icons/pi';
import ChatList from './ChatList';
import DrawerItem, { DrawerItemProps } from './DrawerItem';
import DrawerBase from './DrawerBase';
import Switch from './Switch';
import Button from './Button';
import { useTranslation } from 'react-i18next';
import useUserSetting from '../hooks/useUserSetting';

export type ItemProps = DrawerItemProps & {
  display: 'usecase' | 'tool' | 'none';
};

type Props = BaseProps & {
  items: ItemProps[];
};

const Drawer: React.FC<Props> = (props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { settingShowUseCaseBuilder } = useUserSetting();

  const usecases = useMemo(() => {
    return props.items.filter((i) => i.display === 'usecase');
  }, [props.items]);

  const [searchQuery, setSearchQuery] = useState('');
  const searchWords = useMemo(() => {
    return searchQuery
      .split(' ')
      .flatMap((q) => q.split('　'))
      .filter((q) => q !== '');
  }, [searchQuery]);

  const useCaseBuilderEnabled: boolean =
    import.meta.env.VITE_APP_USE_CASE_BUILDER_ENABLED === 'true';

  const [settingVisibility, setSettingVisibility] = useState(false);

  return (
    <>
      <DrawerBase>
        {useCaseBuilderEnabled && settingShowUseCaseBuilder && (
          <>
            <Switch
              className="mx-3 my-2"
              label={t('drawer.builder_mode')}
              checked={false}
              onSwitch={() => {
                navigate('/use-case-builder');
              }}
            />
            <div className="border-b" />
          </>
        )}
        <div className="text-sidebar-text-muted mx-3 my-1 flex items-center justify-between text-xs">
          <div>
            {t('drawer.use_cases')} <span>{t('drawer.generative_ai')}</span>
          </div>
          <PiGear
            className="text-sidebar-text cursor-pointer text-base"
            onClick={() => {
              setSettingVisibility(!settingVisibility);
            }}
          />
        </div>
        <div className="scrollbar-thin scrollbar-thumb-sidebar-accent scrollbar-track-sidebar-bg ml-2 mr-1 h-full overflow-y-auto">
          {usecases.map((item, idx) => (
            <DrawerItem
              key={idx}
              label={item.label}
              icon={item.icon}
              to={item.to}
              sub={item.sub}
              settingVisibility={settingVisibility}
            />
          ))}

          {settingVisibility && (
            <div className="my-2 flex w-full justify-center">
              <Button
                className="w-full"
                onClick={() => {
                  setSettingVisibility(false);
                }}
                outlined>
                {t('drawer.done')}
              </Button>
            </div>
          )}
        </div>
        <div className="text-sidebar-text-muted mx-3 my-2 text-xs">
          {t('chat.history')}
        </div>
        <div className="relative mb-2 ml-2 mr-1 w-full pl-1.5 pr-7 pt-1">
          <input
            className="bg-aws-squid-ink border-sidebar-accent text-sidebar-text focus:border-sidebar-accent h-7 w-full rounded-full border pl-8 text-sm focus:ring-0"
            type="text"
            value={searchQuery}
            placeholder={t('chat.search_by_title')}
            onChange={(event) => {
              setSearchQuery(event.target.value ?? '');
            }}
          />
          <PiMagnifyingGlass className="bg-aws-squid-ink border-sidebar-accent absolute left-1.5 top-1 size-7 rounded-l-full border p-1.5" />
        </div>
        <div className="scrollbar-thin scrollbar-thumb-sidebar-accent scrollbar-track-sidebar-bg ml-2 mr-1 h-full overflow-y-auto">
          <ChatList className="mr-1" searchWords={searchWords} />
        </div>
      </DrawerBase>
    </>
  );
};

export default Drawer;
