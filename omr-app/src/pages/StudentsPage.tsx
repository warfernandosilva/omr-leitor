import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, GraduationCap, History, Plus, Search, TriangleAlert, Users,
} from 'lucide-react';
import type { AppView } from '../types';
import {
  getTurma, listAlunos, listTurmas,
  type AlunoListItem, type TurmaDTO,
} from '../utils/api';
import { getExams, getResults } from '../utils/storage';
import { duplicateIds, findDuplicateGroups } from '../utils/alunos';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Avatar from '../components/ui/Avatar';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import DataTable from '../components/ui/DataTable';
import StatCard from '../components/ui/StatCard';

interface Props {
  onNavigate: (view: AppView, examId?: string, resultId?: string) => void;
}

const keyOf = (a: AlunoListItem) => `${a.turma_id}-${a.id}`;

/** Catálogo global de alunos (agrega os catálogos das turmas). */
export default function StudentsPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const [alunos, setAlunos] = useState<AlunoListItem[]>([]);
  const [turmas, setTurmas] = useState<TurmaDTO[]>([]);
  const [search, setSearch] = useState('');
  const [turmaFilter, setTurmaFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [all, ts] = await Promise.all([listAlunos(), listTurmas()]);
        if (!alive) return;
        setAlunos(all);
        setTurmas(ts);
      } catch {
        // Backend anterior ao endpoint /api/alunos: agrega via turmas.
        try {
          const ts = await listTurmas();
          const details = await Promise.all(ts.map(t => getTurma(t.id)));
          if (!alive) return;
          setTurmas(ts);
          setAlunos(details.flatMap(d =>
            d.alunos.map(a => ({
              id: a.id,
              nome: a.nome,
              matricula: a.matricula,
              identificador_externo: a.identificador_externo,
              turma_id: d.id,
              turma_nome: d.nome,
            })),
          ));
        } catch (err2) {
          if (!alive) return;
          setError(err2 instanceof Error ? err2.message : 'Falha ao carregar alunos.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const norm = search.trim().toLowerCase();
  const filtered = useMemo(() => alunos.filter(a => {
    if (turmaFilter && String(a.turma_id) !== turmaFilter) return false;
    if (!norm) return true;
    return (
      a.nome.toLowerCase().includes(norm) ||
      (a.matricula ?? '').toLowerCase().includes(norm) ||
      (a.identificador_externo ?? '').toLowerCase().includes(norm)
    );
  }), [alunos, norm, turmaFilter]);

  const dupGroups = useMemo(() => findDuplicateGroups(alunos), [alunos]);
  const dupIdSet = useMemo(() => duplicateIds(dupGroups), [dupGroups]);

  const exams = getExams(user?.id);
  const results = getResults(undefined, user?.id);
  const examName = (id: string) => exams.find(e => e.id === id)?.name ?? 'Prova';
  const selected = filtered.find(a => keyOf(a) === selectedKey) ?? null;
  const selectedHistory = selected
    ? results.filter(r => (r.studentName || '').trim().toLowerCase() === selected.nome.trim().toLowerCase())
    : [];
  const avg = selectedHistory.length
    ? (selectedHistory.reduce((acc, r) => acc + r.grade, 0) / selectedHistory.length).toFixed(1)
    : '—';

  return (
    <div className="app-section animate-fade-in">
      <PageHeader
        title="Alunos"
        subtitle={alunos.length > 0 ? `${alunos.length} aluno(s) em ${turmas.length} turma(s)` : 'Catálogo geral de alunos'}
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => onNavigate('turmas')} icon={<GraduationCap size={15} aria-hidden />} className="min-h-[44px]">
              Gerenciar turmas
            </Button>
            <Button size="sm" onClick={() => onNavigate('turmas')} icon={<Plus size={15} aria-hidden />} className="min-h-[44px]">
              Importar alunos
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Alunos no catálogo" value={alunos.length} tone="info" icon={<Users size={18} aria-hidden />} />
        <StatCard label="Turmas" value={turmas.length} tone="info" icon={<GraduationCap size={18} aria-hidden />} />
        <StatCard label="Possíveis duplicidades" value={dupGroups.length} tone={dupGroups.length ? 'warning' : 'default'} icon={<TriangleAlert size={18} aria-hidden />} />
        <StatCard label="Correções locais" value={results.length} tone="success" icon={<History size={18} aria-hidden />} />
      </div>

      {dupGroups.length > 0 && (
        <div className="callout-warning flex items-start gap-2" role="alert">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" aria-hidden />
          <p>
            <strong>{dupGroups.length} possível(eis) duplicidade(s)</strong> no catálogo
            (mesma matrícula ou mesmo nome em mais de um registro). Confira nas Turmas antes de gerar os cartões.
          </p>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71809A] pointer-events-none" aria-hidden />
            <Input
              type="search"
              aria-label="Buscar aluno"
              placeholder="Buscar por nome, matrícula ou ID externo..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="!pl-9"
            />
          </div>
          <Select
            aria-label="Filtrar por turma"
            value={turmaFilter}
            onChange={e => setTurmaFilter(e.target.value)}
            className="sm:w-52"
          >
            <option value="">Todas as turmas</option>
            {turmas.map(t => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </Select>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {loading ? (
          <Card><p className="text-sm text-[#71809A] dark:text-gray-400" role="status">Carregando alunos...</p></Card>
        ) : error ? (
          <div className="callout-danger" role="alert">{error}</div>
        ) : filtered.length === 0 ? (
          <div>
            <EmptyState
              title={alunos.length === 0 ? 'Nenhum aluno ainda' : 'Nenhum aluno encontrado'}
              description={alunos.length === 0
                ? 'Importe a lista pela página de Turmas para montar o catálogo.'
                : 'Tente ajustar a busca ou o filtro de turma.'}
              icon={<Users size={24} strokeWidth={1.5} aria-hidden />}
              action={
                <Button size="sm" onClick={() => onNavigate('turmas')} icon={<GraduationCap size={15} aria-hidden />}>
                  Ir para Turmas
                </Button>
              }
            />
          </div>
        ) : (
          <DataTable<AlunoListItem>
            rows={filtered}
            rowKey={(a) => keyOf(a)}
            pageSize={20}
            minWidth={840}
            ariaLabel="Catálogo de alunos"
            onRowClick={(a) => setSelectedKey(keyOf(a))}
            empty="Nenhum aluno encontrado."
            mobileCard={(a) => (
              <div className="flex items-center gap-3">
                <Avatar name={a.nome} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[#172B4D] dark:text-white truncate">{a.nome}</p>
                  <p className="text-xs text-[#71809A] dark:text-gray-400 truncate">
                    {a.turma_nome ?? 'Sem turma'}{a.matricula ? ` · #${a.matricula}` : ''}
                  </p>
                </div>
                {dupIdSet.has(a.id)
                  ? <Badge tone="warning">Duplicado?</Badge>
                  : <Badge tone="success">Ativo</Badge>}
              </div>
            )}
            columns={[
              {
                key: 'aluno', header: 'Aluno',
                render: (a) => (
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={a.nome} size="sm" />
                    <div className="min-w-0">
                      <p className="font-medium text-[#172B4D] dark:text-gray-100 truncate">{a.nome}</p>
                      {a.identificador_externo ? <p className="text-xs text-[#71809A] dark:text-gray-400 truncate">ID externo: {a.identificador_externo}</p> : null}
                    </div>
                  </div>
                ),
              },
              { key: 'matricula', header: 'Matrícula', render: (a) => <span className="text-[#71809A] dark:text-gray-400">{a.matricula || '—'}</span> },
              { key: 'turma', header: 'Turma', render: (a) => <span className="text-[#71809A] dark:text-gray-400">{a.turma_nome ?? 'Sem turma'}</span> },
              {
                key: 'situacao', header: 'Situação',
                render: (a) => dupIdSet.has(a.id)
                  ? <Badge tone="warning">Duplicado?</Badge>
                  : <Badge tone="success">Ativo</Badge>,
              },
              {
                key: 'acoes', header: 'Ações', className: 'text-right',
                render: (a) => (
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedKey(keyOf(a)); }}>
                    Ver histórico
                  </Button>
                ),
              },
            ]}
          />
        )}

        <Card className="space-y-4">
          <h3 className="font-semibold text-[#172B4D] dark:text-white">Detalhes do aluno</h3>
          {!selected ? (
            <EmptyState
              title="Selecione um aluno"
              description="Toque em um aluno para ver turma, histórico de avaliações e resultados."
              icon={<ClipboardList size={22} strokeWidth={1.5} aria-hidden />}
            />
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Avatar name={selected.nome} size="md" />
                <div className="min-w-0">
                  <p className="font-semibold text-[#172B4D] dark:text-white truncate">{selected.nome}</p>
                  <p className="text-xs text-[#71809A] dark:text-gray-400 truncate">
                    {selected.turma_nome ?? 'Sem turma'} · {selected.matricula ? `#${selected.matricula}` : 'sem matrícula'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="panel">
                  <p className="text-xs text-[#71809A] dark:text-gray-400">Correções</p>
                  <p className="text-lg font-bold text-[#172B4D] dark:text-white">{selectedHistory.length}</p>
                </div>
                <div className="panel">
                  <p className="text-xs text-[#71809A] dark:text-gray-400">Média</p>
                  <p className="text-lg font-bold text-brand-600 dark:text-brand-200">{avg}</p>
                </div>
              </div>
              <div>
                <p className="label">Histórico de avaliações</p>
                {selectedHistory.length === 0 ? (
                  <p className="text-sm text-[#71809A] dark:text-gray-400">Nenhum resultado encontrado para este aluno neste aparelho.</p>
                ) : (
                  <ul className="divide-y divide-line rounded-[10px] border border-line dark:divide-gray-800 dark:border-gray-800">
                    {selectedHistory.map(r => (
                      <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#172B4D] dark:text-gray-100 truncate">{examName(r.examId)}</p>
                          <p className="text-xs text-[#71809A] dark:text-gray-400">{new Date(r.timestamp).toLocaleString('pt-BR')}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={r.grade >= 6 ? 'success' : r.grade >= 4 ? 'warning' : 'danger'}>
                            Nota {r.grade.toFixed(1)}
                          </Badge>
                          <Button size="sm" variant="ghost" onClick={() => onNavigate('view-result', r.id)}>Ver</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => onNavigate('turmas')} icon={<GraduationCap size={16} aria-hidden />}>
                  Abrir turma
                </Button>
                <Button variant="ghost" onClick={() => setSelectedKey(null)}>Limpar seleção</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
