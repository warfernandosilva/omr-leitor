import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { AppView } from '../types';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import StatCard from '../components/ui/StatCard';
import { getResults, getExams } from '../utils/storage';
import { downloadCSV, downloadXLSX } from '../utils/export';
import { getResultadosFromDB, listTurmas, type DBResultado, type TurmaDTO } from '../utils/api';
import { useAuth } from '../context/AuthContext';

interface Props {
  onNavigate: (view: AppView) => void;
}

type Period = '7' | '30' | '90' | 'all';

function dbToLocal(db: DBResultado): ReturnType<typeof getResults>[number] {
  return {
    id: db.codigo_unico,
    examId: db.avaliacao.external_id,
    studentName: db.aluno.nome,
    answers: (db.respostas as Record<number, string>) || {},
    correctCount: db.acertos ?? 0,
    incorrectCount: db.erros ?? 0,
    blankCount: db.brancos ?? 0,
    duplicateCount: 0,
    duplicateQuestions: [],
    codigoUnico: db.codigo_unico,
    grade: db.nota ?? 0,
    timestamp: db.data_correcao || new Date().toISOString(),
    manualOverrides: {},
  } as ReturnType<typeof getResults>[number];
}

/** Relatórios: filtra por turma/prova/aluno/período e exporta o recorte. */
export default function ReportsPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;

  const [exams] = useState(() => getExams(userId));
  const [local] = useState(() => getResults(undefined, userId));
  const [dbResults, setDbResults] = useState<DBResultado[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [turmas, setTurmas] = useState<TurmaDTO[]>([]);
  const [turmaFilter, setTurmaFilter] = useState('');
  const [examFilter, setExamFilter] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [period, setPeriod] = useState<Period>('30');

  const reloadDb = () => {
    setDbError(null);
    getResultadosFromDB().then(setDbResults).catch((err) => {
      setDbError(err instanceof Error ? err.message : 'Falha ao carregar resultados do servidor.');
    });
  };

  useEffect(() => {
    reloadDb();
    listTurmas().then(setTurmas).catch(() => setTurmas([]));
  }, []);

  const allResults = useMemo(() => {
    const merged = new Map<string, (typeof local)[number]>();
    for (const r of [...local, ...dbResults.map(dbToLocal)]) {
      const key = (r as unknown as { codigoUnico?: string }).codigoUnico || r.id;
      if (!merged.has(key)) merged.set(key, r);
    }
    return Array.from(merged.values());
  }, [local, dbResults]);

  const examById = useMemo(() => new Map(exams.map(e => [e.id, e])), [exams]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const days = period === 'all' ? Infinity : Number(period);
    return allResults.filter(r => {
      if (examFilter && r.examId !== examFilter) return false;
      if (turmaFilter) {
        const ex = examById.get(r.examId);
        const tid = ex?.turmaId != null ? String(ex.turmaId) : null;
        const tname = ex?.turma ?? null;
        const turma = turmas.find(t => String(t.id) === turmaFilter);
        const matchId = tid === turmaFilter;
        const matchName = turma != null && tname != null && tname === turma.nome;
        if (!matchId && !matchName) return false;
      }
      if (studentSearch && !r.studentName.toLowerCase().includes(studentSearch.trim().toLowerCase())) return false;
      if (days !== Infinity) {
        const t = new Date(r.timestamp).getTime();
        if (Number.isNaN(t) || now - t > days * 86400000) return false;
      }
      return true;
    });
  }, [allResults, examFilter, turmaFilter, studentSearch, period, examById, turmas]);

  const stats = useMemo(() => {
    if (filtered.length === 0) return null;
    const grades = filtered.map(r => r.grade);
    return {
      count: filtered.length,
      avg: (grades.reduce((a, b) => a + b, 0) / grades.length),
      max: Math.max(...grades),
      min: Math.min(...grades),
    };
  }, [filtered]);

  const fmt = (v: number) => v.toFixed(1).replace('.', ',');

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Relatórios"
        subtitle={`${filtered.length} resultado(s) no recorte`}
        crumbs={[{ label: 'Análises' }, { label: 'Relatórios' }]}
        actions={<>
          <Button variant="secondary" size="sm" onClick={() => downloadCSV(filtered, exams)} disabled={filtered.length === 0} icon={<Download size={15} aria-hidden />} className="min-h-[44px]">
            Exportar CSV
          </Button>
          <Button size="sm" onClick={() => downloadXLSX(filtered, exams)} disabled={filtered.length === 0} icon={<Download size={15} aria-hidden />} className="min-h-[44px]">
            Exportar XLSX
          </Button>
        </>}
      />

      {dbError && (
        <div className="card callout-warning flex flex-wrap items-center gap-2">
          <span>Resultados do servidor indisponíveis ({dbError}) — mostrando só os salvos neste aparelho.</span>
          <Button size="sm" variant="secondary" onClick={reloadDb} icon={<RefreshCw size={14} aria-hidden />}>Tentar de novo</Button>
        </div>
      )}

      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <Select aria-label="Filtrar por turma" value={turmaFilter} onChange={e => setTurmaFilter(e.target.value)}>
            <option value="">Todas as turmas</option>
            {turmas.map(t => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </Select>
          <Select aria-label="Filtrar por prova" value={examFilter} onChange={e => setExamFilter(e.target.value)}>
            <option value="">Todas as provas</option>
            {exams.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </Select>
          <Input
            type="search"
            aria-label="Buscar aluno"
            placeholder="Buscar aluno..."
            value={studentSearch}
            onChange={e => setStudentSearch(e.target.value)}
          />
          <Select aria-label="Filtrar por período" value={period} onChange={e => setPeriod(e.target.value as Period)}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="all">Todo o período</option>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nenhum resultado no recorte"
          description="Corrija cartões-resposta ou ajuste turma, prova, aluno e período."
          action={<Button size="sm" onClick={() => onNavigate('correct-card')}>Nova leitura</Button>}
        />
      ) : stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Cartões no recorte" value={stats.count} tone="info" />
          <StatCard label="Média do recorte" value={`${fmt(stats.avg)}%`} />
          <StatCard label="Maior nota" value={`${fmt(stats.max)}%`} tone="success" />
          <StatCard label="Menor nota" value={`${fmt(stats.min)}%`} tone="danger" />
        </div>
      )}
    </div>
  );
}
