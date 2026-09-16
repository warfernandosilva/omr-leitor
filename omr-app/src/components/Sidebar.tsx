import { AppView } from '../types';
import { useAuth } from '../context/AuthContext';

interface Props {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const navItems: { view: AppView; label: string; icon: string }[] = [
  { view: 'home', label: 'Início', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { view: 'new-exam', label: 'Nova Prova', icon: 'M12 4v16m8-8H4' },
  { view: 'generate-card', label: 'Gerar Cartão', icon: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z' },
  { view: 'import-students', label: 'Importar Alunos', icon: 'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { view: 'manage-exam', label: 'Gerenciar Avaliação', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2m-6 9l2 2 4-4' },
  { view: 'register-key', label: 'Cadastrar Gabarito', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { view: 'correct-card', label: 'Corrigir Cartão', icon: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z' },
  { view: 'results', label: 'Resultados', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { view: 'dashboard', label: 'Dashboard', icon: 'M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
];

const adminNavItem: { view: AppView; label: string; icon: string } = {
  view: 'admin-users',
  label: 'Usuários',
  icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
};

export default function Sidebar({ currentView, onNavigate, isOpen, onToggle }: Props) {
  const auth = useAuth();
  return (
    <>
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col transition-transform duration-300
          ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <div className="p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">OMR</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">Correção de Cartões</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {[...navItems, ...(auth.user?.role === 'admin' ? [adminNavItem] : [])].map((item) => (
            <button
              key={item.view}
              onClick={() => onNavigate(item.view)}
              aria-current={currentView === item.view ? 'page' : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative min-h-[44px]
                ${currentView === item.view
                  ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                }`}
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
              </svg>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 space-y-2">
          {auth.user && (
            <div className="text-xs text-gray-600 dark:text-gray-300 truncate">
              <p className="font-medium text-gray-800 dark:text-gray-100 truncate">{auth.user.nome || auth.user.email}</p>
              <p className="text-gray-400 truncate">{auth.user.email}</p>
            </div>
          )}
          {auth.user && (
            <button
              onClick={() => auth.logout()}
              className="w-full btn btn-secondary btn-sm justify-center"
            >
              Sair
            </button>
          )}
          <p className="text-xs text-gray-400 text-center">v1.0 — OMR Correção</p>
        </div>
      </aside>
      <button
        onClick={onToggle}
        className={`fixed top-4 left-4 z-[60] p-2 rounded-lg bg-white shadow-md border border-gray-200 lg:hidden transition-opacity
          ${isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </>
  );
}
