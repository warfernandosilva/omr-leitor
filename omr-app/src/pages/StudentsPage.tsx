import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Plus, Search, TriangleAlert, Users } from 'lucide-react';
import type { AppView } from '../types';
import {
  getTurma, listAlunos, listTurmas,
  type AlunoListItem, type TurmaDTO,
} from '../utils/api';
import { duplicateIds, findDuplicateGroups } from '../utils/alunos';
import PageHeader from '../components/ui/PageHeader';
import Avatar from '../components/ui/Avatar';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';

interface Props {
  onNavigate: (view: AppView) => void;
}

/** Catálogo global de alunos (agrega os catálogos das turmas). */
export default function StudentsPage({ onNavigate }: Props) {
  const [alunos, setAlunos] = useState<AlunoListItem[]>([]);
  const [turmas, setTurmas] = useState<TurmaDTO[]>([]);
  const [search, setSearch] = useState('');
  const [turmaFilter, setTurmaFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      } catch (err) {
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

  return (
    <div className="space-y-4 animate-fade-in">
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

      {dupGroups.length > 0 && (
        <div className="callout-warning flex items-start gap-2" role="alert">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" aria-hidden />
          <p>
            <strong>{dupGroups.length} possível(eis) duplicidade(s)</strong> no catálogo
            (mesma matrícula ou mesmo nome em mais de um registro). Confira nas Turmas antes de gerar os cartões.
          </p>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden />
          <Input
            type="search"
            aria-label="Buscar aluno"
            placeholder="Buscar por nome ou matrícula..."
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

      {loading ? (
        <div className="card text-center py-12"><p className="text-gray-500 dark:text-gray-400" role="status">Carregando alunos...</p></div>
      ) : error ? (
        <div className="callout-danger" role="alert">{error}</div>
      ) : filtered.length === 0 ? (
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
      ) : (
        <ul className="card card-pad-none divide-y divide-line dark:divide-gray-800" aria-label="Lista de alunos">
          {filtered.map(a => (
            <li key={`${a.turma_id}-${a.id}`} className="flex items-center gap-3 px-4 py-3 min-h-[60px]">
              <Avatar name={a.nome} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink dark:text-gray-100 truncate">{a.nome}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {a.turma_nome ?? 'Sem turma'}
                  {a.matricula ? ` · #${a.matricula}` : ''}
                </p>
              </div>
              {dupIdSet.has(a.id)
                ? <Badge tone="warning">Duplicado?</Badge>
                : <Badge tone="success">Ativo</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
