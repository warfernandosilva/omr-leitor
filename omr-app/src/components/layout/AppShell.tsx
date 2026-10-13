import type { ReactNode } from 'react';
import type { AppView } from '../../types';
import type { Crumb } from '../ui/Breadcrumbs';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

interface Props {
  children: ReactNode;
  currentView: AppView;
  onNavigate: (view: AppView, examId?: string, resultId?: string) => void;
  crumbs: Crumb[];
  /** Páginas de trabalho intensivo ocupam a largura total do monitor. */
  wide: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
  onCloseDrawer: () => void;
}

/** Estrutura global: sidebar + cabeçalho + conteúdo. */
export default function AppShell({
  children, currentView, onNavigate, crumbs, wide,
  collapsed, onToggleCollapse, drawerOpen, onOpenDrawer, onCloseDrawer,
}: Props) {
  return (
    <div className="min-h-screen flex bg-surface dark:bg-gray-950">
      <Sidebar
        currentView={currentView}
        onNavigate={onNavigate}
        drawerOpen={drawerOpen}
        onCloseDrawer={onCloseDrawer}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
      />
      <div className={`flex-1 min-w-0 min-h-screen transition-[margin] duration-300 ${collapsed ? 'lg:ml-[76px]' : 'lg:ml-[260px]'}`}>
        <Topbar
          crumbs={crumbs}
          onNavigate={onNavigate}
          onOpenMenu={onOpenDrawer}
        />
        <main>
          <div className={wide ? 'p-4 md:p-6 animate-fade-in' : 'p-4 md:p-6 lg:p-8 max-w-6xl mx-auto animate-fade-in'}>
            {children}
          </div>
        </main>
      </div>
      {drawerOpen && (
        <div className="fixed inset-0 bg-navy-950/50 z-40 lg:hidden" onClick={onCloseDrawer} aria-hidden />
      )}
    </div>
  );
}
