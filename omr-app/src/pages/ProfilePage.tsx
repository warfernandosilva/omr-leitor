import { LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
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
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Perfil do usuário"
        subtitle="Sua identificação no aplicativo"
        crumbs={[{ label: 'Sistema' }, { label: 'Perfil do usuário' }]}
      />

      <div className="card">
        <div className="flex items-center gap-4">
          <Avatar name={userName} size="lg" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink dark:text-white truncate">{userName}</h2>
            <div className="mt-1">
              <Badge tone="info" icon={isAdmin ? <ShieldCheck size={13} aria-hidden /> : <UserRound size={13} aria-hidden />}>
                {isAdmin ? 'Administrador' : 'Professor'}
              </Badge>
            </div>
          </div>
        </div>

        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex items-center gap-3 p-3 bg-surface dark:bg-gray-800/60 rounded-lg">
            <UserRound size={16} className="text-gray-400 shrink-0" aria-hidden />
            <div className="min-w-0">
              <dt className="text-xs text-gray-500 dark:text-gray-400">Nome</dt>
              <dd className="font-medium text-ink dark:text-gray-100 truncate">{user?.nome || '—'}</dd>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-surface dark:bg-gray-800/60 rounded-lg">
            <Mail size={16} className="text-gray-400 shrink-0" aria-hidden />
            <div className="min-w-0">
              <dt className="text-xs text-gray-500 dark:text-gray-400">E-mail</dt>
              <dd className="font-medium text-ink dark:text-gray-100 truncate">{user?.email || '—'}</dd>
            </div>
          </div>
        </dl>

        <div className="mt-5 flex flex-col sm:flex-row gap-2">
          <Button variant="secondary" onClick={() => onNavigate('settings')} className="min-h-[44px]">
            Abrir configurações
          </Button>
          <Button variant="danger" onClick={() => auth.logout()} icon={<LogOut size={16} aria-hidden />} className="min-h-[44px]">
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
