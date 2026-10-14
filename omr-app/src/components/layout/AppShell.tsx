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
          currentView={currentView}
          examId={examId}
          onNavigate={onNavigate}
          onOpenMenu={onOpenDrawer}
        />
        <main className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
          <div className={wide ? 'p-4 md:p-6 animate-fade-in' : 'p-4 md:p-6 lg:p-8 max-w-6xl mx-auto animate-fade-in'}>
            {children}
          </div>
        </main>
      </div>
      <BottomNav currentView={currentView} onNavigate={onNavigate} onOpenMenu={onOpenDrawer} />
      {drawerOpen && (
        <div className="fixed inset-0 bg-navy-950/50 z-40 lg:hidden" onClick={onCloseDrawer} aria-hidden />
      )}
    </div>
  );
}
