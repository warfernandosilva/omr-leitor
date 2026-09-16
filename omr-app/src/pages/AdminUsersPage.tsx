import { useState, useEffect } from 'react';
import { AppView } from '../types';
import { adminListUsers, adminUpdateUser, adminDeleteUser, AdminUser, getMe } from '../utils/api';

interface Props {
  onNavigate: (view: AppView) => void;
}

export default function AdminUsersPage({ onNavigate }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuários do Sistema</h1>
          <p className="text-gray-500 text-sm">Exclusivo para administradores — gerencie acesso e papéis</p>
        </div>
        <button onClick={load} className="btn btn-secondary btn-sm">Atualizar</button>
      </div>

      {loading && <div className="card text-center py-12"><p className="text-gray-500">Carregando usuários...</p></div>}

      {error && (
        <div className="card bg-red-50 border-red-200 text-red-700 text-sm p-4 mb-4">
          {error}
          {error.includes('403') && <p className="mt-2 text-xs">Você precisa ser administrador para acessar esta página.</p>}
          <button onClick={() => onNavigate('home')} className="btn btn-sm btn-secondary mt-3">Voltar ao início</button>
        </div>
      )}

      {!loading && !error && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-3 px-3 text-left font-medium text-gray-500">Nome</th>
                <th className="py-3 px-3 text-left font-medium text-gray-500">E-mail</th>
                <th className="py-3 px-3 text-left font-medium text-gray-500">Papel</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500">Ativo</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500">Provas</th>
                <th className="py-3 px-3 text-left font-medium text-gray-500 hidden md:table-cell">Criado em</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isMe = meEmail && u.email === meEmail;
                return (
                  <tr key={u.id} className={`border-b border-gray-50 hover:bg-gray-50 ${!u.is_active ? 'opacity-50' : ''}`}>
                    <td className="py-3 px-3 font-medium text-gray-900">
                      {u.nome} {isMe && <span className="text-xs text-blue-600 font-normal">(você)</span>}
                    </td>
                    <td className="py-3 px-3 text-gray-500">{u.email}</td>
                    <td className="py-3 px-3">
                      <select
                        value={u.role}
                        onChange={e => handleRoleChange(u, e.target.value)}
                        className="input py-1 px-2 text-xs w-28"
                        disabled={Boolean(isMe) && users.filter(x => x.role === 'admin').length <= 1 && u.role === 'admin'}
                        title={isMe && u.role === 'admin' ? 'Último admin não pode ser rebaixado' : undefined}
                      >
                        <option value="professor">professor</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={!!isMe}
                        className={`px-2 py-1 rounded-full text-xs font-medium ${u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'} disabled:opacity-50`}
                        title={isMe ? 'Não pode desativar a própria conta' : undefined}
                      >
                        {u.is_active ? 'Ativo' : 'Inativo'}
                      </button>
                    </td>
                    <td className="py-3 px-3 text-center text-gray-600">{u.avaliacoes}</td>
                    <td className="py-3 px-3 text-gray-400 text-xs hidden md:table-cell">
                      {u.created_at ? new Date(u.created_at).toLocaleString('pt-BR') : '—'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => handleResetPassword(u)}
                          className="btn btn-sm btn-secondary"
                          title="Redefinir senha"
                        >
                          Senha
                        </button>
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={!!isMe}
                          className="btn btn-sm btn-danger disabled:opacity-30"
                          title={isMe ? 'Não pode excluir a própria conta' : 'Excluir usuário'}
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">Nenhum usuário cadastrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
