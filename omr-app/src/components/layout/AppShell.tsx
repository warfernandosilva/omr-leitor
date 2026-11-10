import type { ReactNode } from 'react';
import type { AppView } from '../../types';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import BottomNav from './BottomNav';

interface Props {
  children: ReactNode;
  currentView: AppView;
  onNavigate: (view: AppView, examId?: string, resultId?: string) => void;
  /** Prova selecionada (para o contexto do cabeçalho). */
  examId?: string | null;
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
  children, currentView, onNavigate, examId, wide,
  collapsed, onToggleCollapse, drawerOpen, onOpenDrawer, onCloseDrawer,
}: Props) {
  return (
    <div className="app-bg min-h-screen flex text-[#172B4D] dark:text-gray-100">
      <Sidebar
        currentView={currentView}
        onNavigate={onNavigate}
        drawerOpen={drawerOpen}
        onCloseDrawer={onCloseDrawer}
        collapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
      />
      <div className={`flex-1 min-w-0 min-h-screen transition-[margin] duration-300 ${collapsed ? 'lg:ml-[84px]' : 'lg:ml-[268px]'}`}>
        <Topbar
          currentView={currentView}
          examId={examId}
          onNavigate={onNavigate}
          onOpenMenu={onOpenDrawer}
        />
        <main className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          <div className={`p-4 md:p-6 lg:p-7 animate-fade-in ${wide ? 'w-full' : 'mx-auto w-full max-w-[1440px]'}`}>
            {children}
          </div>
        </main>
      </div>
      <BottomNav currentView={currentView} onNavigate={onNavigate} onOpenMenu={onOpenDrawer} />
      {drawerOpen && (
        <div className="fixed inset-0 bg-navy-950/40 backdrop-blur-sm z-40 lg:hidden" onClick={onCloseDrawer} aria-hidden />
      )}
    </div>
  );
}
