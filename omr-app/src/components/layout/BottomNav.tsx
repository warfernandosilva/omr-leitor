import { Menu } from 'lucide-react';
import type { AppView } from '../../types';
import { BOTTOM_NAV } from './nav';

interface Props {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenMenu: () => void;
}

/** Barra de navegação inferior (só mobile): atalhos das funções mais usadas. */
export default function BottomNav({ currentView, onNavigate, onOpenMenu }: Props) {
  return (
    <nav
      aria-label="Navegação rápida"
      className="fixed bottom-0 inset-x-0 z-40 lg:hidden bg-white dark:bg-gray-900 border-t border-line dark:border-gray-800 shadow-[0_-4px_16px_rgba(16,24,40,0.08)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-5">
        {BOTTOM_NAV.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.view;
          return (
            <button
              key={item.view}
              onClick={() => onNavigate(item.view)}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-1 py-2 min-h-[60px] text-[11px] font-medium transition-colors
                ${active
                  ? 'text-brand-600 dark:text-brand-200'
                  : 'text-gray-500 hover:text-ink dark:text-gray-400 dark:hover:text-white'
                }`}
            >
              <Icon size={22} strokeWidth={active ? 2.2 : 2} aria-hidden />
              <span className="leading-none">{item.label}</span>
              <span
                aria-hidden
                className={`h-1 w-8 rounded-full transition-colors ${active ? 'bg-brand-500' : 'bg-transparent'}`}
              />
            </button>
          );
        })}
        <button
          onClick={onOpenMenu}
          aria-label="Abrir menu"
          className="flex flex-col items-center justify-center gap-1 py-2 min-h-[60px] text-[11px] font-medium text-gray-500 hover:text-ink dark:text-gray-400 dark:hover:text-white transition-colors"
        >
          <Menu size={22} strokeWidth={2} aria-hidden />
          <span className="leading-none">Mais</span>
          <span aria-hidden className="h-1 w-8 rounded-full bg-transparent" />
        </button>
      </div>
    </nav>
  );
}
