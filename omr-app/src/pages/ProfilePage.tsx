import { LogOut, Mail, Settings, ShieldCheck, UserRound } from 'lucide-react';
import type { AppView } from '../types';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Avatar from '../components/ui/Avatar';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';

interface Props {
  onNavigate: (view: AppView) => void;
}

/** Perfil do usuário (somente leitura): identificação, papel e saída. */
export default function ProfilePage({ onNavigate }: Props) {
  const auth = useAuth();
  const user = auth.user;
  const userName = user?.nome || user?.email || 'Usuário';
  const isAdmin = user?.role === 'admin';

  return (
    <div className="app-section animate-fade-in">
      <PageHeader
        title="Perfil do usuário"
        subtitle="Sua identificação no aplicativo"
        crumbs={[{ label: 'Sistema' }, { label: 'Perfil do usuário' }]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="card-glass">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={userName} size="lg" />
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-[#172B4D] dark:text-white truncate">{userName}</h2>
              <div className="mt-1">
                <Badge tone="info" icon={isAdmin ? <ShieldCheck size={13} aria-hidden /> : <UserRound size={13} aria-hidden />}>
                  {isAdmin ? 'Administrador' : 'Professor'}
                </Badge>
              </div>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="panel">
              <div className="flex items-start gap-3">
                <UserRound size={16} className="text-brand-600 dark:text-brand-200 shrink-0 mt-0.5" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-[#71809A] dark:text-gray-400">Nome</dt>
                  <dd className="font-medium text-[#172B4D] dark:text-gray-100 truncate">{user?.nome || '—'}</dd>
                </div>
              </div>
            </div>
            <div className="panel">
              <div className="flex items-start gap-3">
                <Mail size={16} className="text-brand-600 dark:text-brand-200 shrink-0 mt-0.5" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-[#71809A] dark:text-gray-400">E-mail</dt>
                  <dd className="font-medium text-[#172B4D] dark:text-gray-100 truncate">{user?.email || '—'}</dd>
                </div>
              </div>
            </div>
          </dl>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => onNavigate('settings')} icon={<Settings size={16} aria-hidden />} className="min-h-[44px]">
              Abrir configurações
            </Button>
            <Button variant="danger" onClick={() => auth.logout()} icon={<LogOut size={16} aria-hidden />} className="min-h-[44px]">
              Sair
            </Button>
          </div>
        </div>

        <div className="panel">
          <h3 className="font-semibold text-[#172B4D] dark:text-white">Sua conta</h3>
          <p className="text-sm text-[#71809A] dark:text-gray-400 mt-1">
            Os dados da conta ficam no banco configurado. Provas e resultados têm cache local
            para acesso rápido no aparelho.
          </p>
        </div>
      </div>
    </div>
  );
}
