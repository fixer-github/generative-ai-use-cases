/**
 * 新UI（GaiXer 医療版）のレイアウトシェル。
 * 280px サイドバー + メイン領域（<Outlet/>）のグリッド。
 *
 * トークンとシェルCSSはこのコンポーネントから読み込む。デザイントークンは
 * tokens.css で .gx-scope に閉じて定義しているため、ルート要素に gx-scope を
 * 付与することで旧UI（AWS系配色）へは一切干渉しない（着工方針：新UI配下スコープ）。
 */
import React from 'react';
import { Outlet } from 'react-router-dom';
import GxSidebar from './components/GxSidebar';
import './styles/shell.css';

const GxLayout: React.FC = () => {
  return (
    <div className="gx-scope gx-frame">
      <div className="gx-sidebar-col">
        <GxSidebar />
      </div>
      <main className="gx-main">
        <Outlet />
      </main>
    </div>
  );
};

export default GxLayout;
