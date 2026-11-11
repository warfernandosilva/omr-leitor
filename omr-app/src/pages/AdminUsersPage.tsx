import { useState, useEffect, useRef } from 'react';
import { Download, KeyRound, RefreshCw, Trash2, Upload } from 'lucide-react';
import { AppView } from '../types';
import { adminListUsers, adminUpdateUser, adminDeleteUser, AdminUser, getMe, adminDownloadBackup, adminRestoreBackup } from '../utils/api';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Select from '../components/ui/Select';
import DataTable from '../components/ui/DataTable';

interface Props {
  onNavigate: (view: AppView) => void;
}

export default function AdminUsersPage({ onNavigate }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);
  // Backup do banco
  const [bkBusy, setBkBusy] = useState(false);
  const [bkMsg, setBkMsg] = useState<string | null>(null);
  const [bkConfirm, setBkConfirm] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, me] = await Promise.all([adminListUsers(), getMe().catch(() => null)]);
      setUsers(list);
      if (me) setMeEmail(me.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRoleChange = async (u: AdminUser, newRole: string) => {
    if (u.role === newRole) return;
    if (!confirm(`Alterar ${u.nome} (${u.email}) de "${u.role}" para "${newRole}"?`)) return;
    try {
      await adminUpdateUser(u.id, { role: newRole });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao alterar papel');
    }
  };

  const handleToggleActive = async (u: AdminUser) => {
    const next = !u.is_active;
    if (!confirm(`${next ? 'Reativar' : 'Desativar'} o usuário ${u.nome} (${u.email})?`)) return;
    try {
      await adminUpdateUser(u.id, { is_active: next });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao alterar status');
    }
  };

  const handleDelete = async (u: AdminUser) => {
    if (!confirm(`Excluir permanentemente ${u.nome} (${u.email})?\n\nAs avaliações dele ficarão órfãs (visíveis para todos). Esta ação não pode ser desfeita.`)) return;
    try {
      await adminDeleteUser(u.id);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao excluir');
    }
  };

  const handleResetPassword = async (u: AdminUser) => {
    const nova = prompt(`Nova senha para ${u.nome} (${u.email}):`, '');
    if (nova === null) return;
    if (nova.trim().length < 4) { alert('Senha deve ter ao menos 4 caracteres.'); return; }
    try {
      await adminUpdateUser(u.id, { password: nova.trim() });
      alert(`Senha de ${u.nome} redefinida com sucesso.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao redefinir senha');
    }
  };

  const handleDownloadBackup = async () => {
    setBkBusy(true);
    setBkMsg(null);
    try {
      const name = await adminDownloadBackup();
      setBkMsg(`Backup baixado: ${name}. Guarde em local seguro (contém hashes de senha).`);
    } catch (err) {
      setBkMsg(err instanceof Error ? err.message : 'Falha ao gerar backup');
    } finally {
      setBkBusy(false);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!bkConfirm) {
      setBkMsg('Marque a confirmação ("entendo que o restore atualiza registros") antes de enviar.');
      return;
    }
    if (!confirm(`Restaurar o backup "${file.name}"?\n\nRegistros existentes serão ATUALIZADOS (upsert por id). Um backup pré-restore é gravado automaticamente no servidor.`)) return;
    setBkBusy(true);
    setBkMsg(null);
    try {
      const r = await adminRestoreBackup(file, true);
      if (r.restored) {
        const c = r.counts;
        setBkMsg(`Restore concluído: ${c?.avaliacoes ?? 0} provas, ${c?.alunos ?? 0} alunos, ${c?.gabaritos ?? 0} gabaritos, ${c?.users ?? 0} usuários. Pré-restore: ${r.pre_restore}. Se algum usuário foi alterado, ele precisará relogar.`);
        setBkConfirm(false);
      } else {
        setBkMsg(r.error || 'Restore recusado pelo servidor.');
      }
    } catch (err) {
      setBkMsg(err instanceof Error ? err.message : 'Falha no restore');
    } finally {
      setBkBusy(false);
    }
  };

  return (
    <div className="app-section animate-fade-in">
      <PageHeader
        title="Usuários do sistema"
        subtitle="Exclusivo para administradores — gerencie acesso e papéis"
        actions={
          <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw size={15} aria-hidden />}>
            Atualizar
          </Button>
        }
      />

      {loading && (
        <div className="card text-center py-12">
          <p className="text-[#71809A] dark:text-gray-400" role="status">Carregando usuários...</p>
        </div>
      )}

      {error && (
        <div className="callout-danger">
          {error}
          {error.includes('403') && <p className="mt-2 text-xs">Você precisa ser administrador para acessar esta página.</p>}
          <Button variant="secondary" size="sm" onClick={() => onNavigate('home')} className="mt-3">Voltar ao início</Button>
        </div>
      )}

      {!loading && !error && (
        <div className="card card-glass">
          <div className="section-header mb-3">
            <div>
              <h3 className="text-lg font-semibold text-[#172B4D] dark:text-white">Backup do banco</h3>
              <p className="text-xs text-[#71809A] dark:text-gray-400">
                Dump portátil (provas, alunos, gabaritos, usuários).
              </p>
            </div>
            <Badge tone="warning">Contém hashes de senha</Badge>
          </div>
          <p className="text-xs text-[#71809A] dark:text-gray-400 mb-3">
            O arquivo contém dados sensíveis — guarde em local seguro e nunca no Git.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleDownloadBackup} loading={bkBusy} icon={<Download size={15} aria-hidden />}>
              Baixar backup
            </Button>
            <Button size="sm" variant="secondary" onClick={() => restoreInputRef.current?.click()} disabled={bkBusy} icon={<Upload size={15} aria-hidden />}>
              Enviar restore…
            </Button>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 ml-1 min-h-[44px]">
              <input
                type="checkbox"
                checked={bkConfirm}
                onChange={e => setBkConfirm(e.target.checked)}
                className="w-4 h-4 accent-brand-500"
              />
              Entendo que o restore atualiza registros existentes
            </label>
          </div>
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleRestoreFile}
          />
          {bkMsg && (
            <div className="callout-info mt-3">
              {bkMsg}
            </div>
          )}
        </div>
      )}

      {!loading && !error && (
        <div className="table-shell">
          <DataTable<AdminUser>
            rows={users}
            rowKey={(u) => String(u.id)}
            pageSize={20}
            minWidth={860}
            ariaLabel="Tabela de usuários"
            empty="Nenhum usuário cadastrado."
            mobileCard={(u) => {
              const isMe = meEmail && u.email === meEmail;
              return (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#172B4D] dark:text-gray-100 truncate">
                        {u.nome} {isMe && <Badge tone="info">você</Badge>}
                      </p>
                      <p className="text-xs text-[#71809A] dark:text-gray-400 truncate">{u.email}</p>
                      <p className="text-xs text-[#71809A] dark:text-gray-400 mt-1">
                        {u.role === 'admin' ? 'Administrador' : 'Professor'} · {u.avaliacoes} prova(s)
                      </p>
                    </div>
                    <button
                      onClick={() => handleToggleActive(u)}
                      disabled={!!isMe}
                      className="disabled:opacity-50 min-h-[44px]"
                      title={isMe ? 'Não pode desativar a própria conta' : undefined}
                    >
                      <Badge tone={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'Ativo' : 'Inativo'}</Badge>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={`Papel de ${u.nome}`}
                      value={u.role}
                      onChange={e => handleRoleChange(u, e.target.value)}
                      className="py-1 px-2 text-xs w-32"
                      disabled={Boolean(isMe) && users.filter(x => x.role === 'admin').length <= 1 && u.role === 'admin'}
                      title={isMe && u.role === 'admin' ? 'Último admin não pode ser rebaixado' : undefined}
                    >
                      <option value="professor">professor</option>
                      <option value="admin">admin</option>
                    </Select>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleResetPassword(u)}
                      icon={<KeyRound size={14} aria-hidden />}
                    >
                      Senha
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(u)}
                      disabled={!!isMe}
                      icon={<Trash2 size={14} aria-hidden />}
                    >
                      Excluir
                    </Button>
                  </div>
                </div>
              );
            }}
            columns={[
              { key: 'nome', header: 'Nome', render: (u) => {
                const isMe = meEmail && u.email === meEmail;
                return (
                  <span className="font-medium text-[#172B4D] dark:text-gray-100">
                    {u.nome} {isMe && <Badge tone="info" className="ml-1">você</Badge>}
                  </span>
                );
              } },
              { key: 'email', header: 'E-mail', render: (u) => <span className="text-[#71809A] dark:text-gray-400">{u.email}</span> },
              { key: 'role', header: 'Papel', render: (u) => (
                <Select
                  aria-label={`Papel de ${u.nome}`}
                  value={u.role}
                  onChange={e => handleRoleChange(u, e.target.value)}
                  className="py-1 px-2 text-xs w-28"
                  disabled={Boolean(meEmail && u.email === meEmail) && users.filter(x => x.role === 'admin').length <= 1 && u.role === 'admin'}
                  title={meEmail && u.email === meEmail && u.role === 'admin' ? 'Último admin não pode ser rebaixado' : undefined}
                >
                  <option value="professor">professor</option>
                  <option value="admin">admin</option>
                </Select>
              ) },
              { key: 'ativo', header: 'Ativo', className: 'text-center', render: (u) => {
                const isMe = meEmail && u.email === meEmail;
                return (
                  <button
                    onClick={() => handleToggleActive(u)}
                    disabled={!!isMe}
                    className="disabled:opacity-50 min-h-[44px]"
                    title={isMe ? 'Não pode desativar a própria conta' : undefined}
                  >
                    <Badge tone={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'Ativo' : 'Inativo'}</Badge>
                  </button>
                );
              } },
              { key: 'provas', header: 'Provas', className: 'text-center', render: (u) => <span className="text-[#71809A] dark:text-gray-300 tabular-nums">{u.avaliacoes}</span> },
              { key: 'criado', header: 'Criado em', className: 'hidden md:table-cell', render: (u) => (
                <span className="text-[#71809A] dark:text-gray-400 text-xs">
                  {u.created_at ? new Date(u.created_at).toLocaleString('pt-BR') : '—'}
                </span>
              ) },
              { key: 'acoes', header: 'Ações', className: 'text-center', render: (u) => {
                const isMe = meEmail && u.email === meEmail;
                return (
                  <div className="flex gap-1 justify-center">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleResetPassword(u)}
                      icon={<KeyRound size={14} aria-hidden />}
                      title="Redefinir senha"
                    >
                      Senha
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(u)}
                      disabled={!!isMe}
                      icon={<Trash2 size={14} aria-hidden />}
                      title={isMe ? 'Não pode excluir a própria conta' : 'Excluir usuário'}
                    >
                      Excluir
                    </Button>
                  </div>
                );
              } },
            ]}
          />
        </div>
      )}
    </div>
  );
}
