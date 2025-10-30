import { Link, useLocation } from 'react-router-dom';
import { BaseProps } from '../@types/common';

export type SidebarItemProps = BaseProps & {
  label: string;
  to: string;
  icon: JSX.Element;
};

const SidebarItem: React.FC<SidebarItemProps> = (props) => {
  const location = useLocation();

  // Check if current path matches the target path
  // For exact match or when the path starts with target + '/'
  const isActive =
    location.pathname === props.to ||
    (props.to !== '/' && location.pathname.startsWith(props.to + '/'));

  return (
    <Link
      className={`flex flex-col items-center justify-center rounded-lg p-2 transition-colors ${
        isActive
          ? 'bg-blue-600 text-white'
          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
      } ${props.className}`}
      to={props.to}
      title={props.label}>
      <span className="text-2xl">{props.icon}</span>
      <span className="mt-1 text-center text-xs leading-tight">
        {props.label}
      </span>
    </Link>
  );
};

export default SidebarItem;
