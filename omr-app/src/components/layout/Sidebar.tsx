import { ChevronsLeft, ChevronsRight, LogOut, ScanSearch, X } from 'lucide-react';
import type { AppView } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { NAV_GROUPS } from './nav';
import Avatar from '../ui/Avatar';

interface Props {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  /** Drawer aberto (mobile). No desktop a sidebar é sempre visível. */
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  /** Colapsada = só ícones (desktop). No mobile o drawer abre expandido. */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  currentView, onNavigate, drawerOpen, onCloseDrawer, collapsed, onToggleCollapse,
}: Props) {
  const auth = useAuth();
  const isAdmin = auth.user?.role === 'admin';
  const userName = auth.user?.nome || auth.user?.email || 'Usuário';

  return (
    <aside
      aria-label="Navegação principal"
      className={`fixed top-0 left-0 z-50 h-full w-[260px] flex flex-col bg-white dark:bg-gray-900 border-r border-line dark:border-gray-800 transition-all duration-300
        ${drawerOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
        ${collapsed ? 'lg:w-[76px]' : ''}`}
    >
      {/* Topo: logo + colapso */}
      <div className={`flex items-center gap-3 p-4 border-b border-line dark:border-gray-800 ${collapsed ? 'lg:flex-col lg:justify-center lg:gap-2 lg:px-2 lg:py-3' : ''}`}>
        <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center shrink-0" aria-hidden>
          <ScanSearch size={22} strokeWidth={2} className="text-white" />
        </div>
        <div className={`flex-1 min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
          <p className="text-base font-bold text-ink dark:text-white leading-tight">Gabarito+</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">Correção OMR</p>
        </div>
        <button
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-pressed={collapsed}
          className={`btn-icon hidden lg:inline-flex ${collapsed ? 'lg:hidden' : ''}`}
        >
          <ChevronsLeft size={18} />
        </button>
        {collapsed && (
          <button
            onClick={onToggleCollapse}
            aria-label="Expandir menu"
            aria-pressed={collapsed}
            className="btn-icon hidden lg:inline-flex"
          >
            <ChevronsRight size={18} />
          </button>
        )}
        <button
          onClick={onCloseDrawer}
          aria-label="Fechar menu"
          className="btn-icon lg:hidden"
        >
          <X size={18} />
        </button>
      </div>

      {/* Grupos */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-5" aria-label="Menu">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.adminOnly || isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={group.id}>
              <p className={`px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 ${collapsed ? 'lg:hidden' : ''}`}>
                {group.label}
              </p>
              {collapsed && (
                <div className="hidden lg:block mx-3 mb-1.5 border-t border-line dark:border-gray-800" aria-hidden />
              )}
              <ul className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = currentView === item.view;
                  return (
                    <li key={item.view}>
                      <button
                        onClick={() => onNavigate(item.view)}
                        aria-label={item.label}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? item.label : undefined}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]
                          ${collapsed ? 'lg:justify-center lg:px-0' : ''}
                          ${active
                            ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-200'
                            : 'text-gray-600 hover:bg-surface hover:text-ink dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                          }`}
                      >
                        <Icon size={20} strokeWidth={2} className="shrink-0" aria-hidden />
                        <span className={`flex-1 text-left truncate ${collapsed ? 'lg:hidden' : ''}`}>
                          {item.label}
                        </span>
                        {item.soon && (
                          <span className={`badge-neutral badge !px-1.5 !py-0 text-[10px] ${collapsed ? 'lg:hidden' : ''}`}>
                            Em breve
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Rodapé: usuário + sair */}
      <div className="p-3 border-t border-line dark:border-gray-800">
        {auth.user && (
          <div className={`flex items-center gap-2.5 px-1 py-1 ${collapsed ? 'lg:flex-col lg:justify-center lg:gap-1.5 lg:px-0' : ''}`}>
            <Avatar name={userName} size="sm" />
            <div className={`flex-1 min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <p className="text-xs font-medium text-ink dark:text-gray-100 truncate">{userName}</p>
              <p className="text-[11px] text-gray-400 truncate">
                {isAdmin ? 'Administrador' : 'Professor'}
              </p>
            </div>
            <button
              onClick={() => auth.logout()}
              aria-label="Sair"
              title="Sair"
              className="btn-icon !min-h-[36px] !min-w-[36px]"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
        <p className={`text-[11px] text-gray-400 text-center mt-2 ${collapsed ? 'lg:hidden' : ''}`}>
          v1.0 — Gabarito+
        </p>
      </div>
    </aside>
  );
}
