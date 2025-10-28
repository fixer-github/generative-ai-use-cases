import { Link, useLocation } from 'react-router-dom';
import { BaseProps } from '../@types/common';
import useDrawer from '../hooks/useDrawer';
import { useCallback } from 'react';

export type DrawerItemProps = BaseProps & {
  label: string;
  to: string;
  icon: JSX.Element;
  sub?: string;
};

const DrawerItem: React.FC<DrawerItemProps> = (props) => {
  const location = useLocation();
  const { switchOpen } = useDrawer();

  // If the screen is narrow, close the Drawer when clicked
  const onClick = useCallback(() => {
    if (
      document
        .getElementById('smallDrawerFiller')
        ?.classList.contains('visible')
    ) {
      switchOpen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Link
      className={`hover:bg-aws-sky flex flex-col items-center justify-center rounded p-2 transition-colors ${
        location.pathname === props.to && 'bg-aws-sky'
      } ${props.className}`}
      to={props.to}
      onClick={onClick}
      title={props.label}>
      <span className="text-2xl">{props.icon}</span>
      <span className="mt-1 text-center text-xs leading-tight">
        {props.label}
      </span>
    </Link>
  );
};

export default DrawerItem;
