import type { AppView } from '../../types';
import { BOTTOM_NAV } from './nav';

interface Props {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
}

/** Barra de navegação inferior (só mobile): atalhos das funções mais usadas. */
export default function BottomNav({ currentView, onNavigate }: Props) {
  return (
    <nav
      aria-label="Navegação rápida"
      className="fixed z-40 lg:hidden left-3 right-3 glass bg-brand-50/80 rounded-2xl shadow-glass overflow-hidden"
      /* Flutuante: descolada das bordas; a safe-area entra no offset inferior. */
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
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
      </div>
    </nav>
  );
}
