import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AppView } from '../types';
import { getExams, getResults } from '../utils/storage';
import { getResultadosFromDB, DBResultado } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import DataTable from '../components/ui/DataTable';
import ThemeToggle from '../components/ui/ThemeToggle';

interface Props { onNavigate: (view: AppView, examId?: string, resultId?: string) => void; }

function dbToLocal(db: DBResultado) {
  return {
    id: db.codigo_unico,
    examId: db.avaliacao.external_id,
    studentName: db.aluno.nome,
    answers: (db.respostas as Record<number, string>) || {},
    correctCount: db.acertos ?? 0,
    incorrectCount: db.erros ?? 0,
    blankCount: db.brancos ?? 0,
    duplicateCount: 0,
    duplicateQuestions: [] as number[],
    grade: db.nota ?? 0,
    timestamp: db.data_correcao || new Date().toISOString(),
    manualOverrides: {} as Record<number,string>,
    codigoUnico: db.codigo_unico,
  };
}

export default function DashboardPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;
  const exams = getExams(userId);
  const [dbResults, setDbResults] = useState<DBResultado[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExamId, setSelectedExamId] = useState<string>(exams[0]?.id || '');

  useEffect(() => { getResultadosFromDB().then(setDbResults).catch(()=>{}).finally(()=>setLoading(false)); }, []);
  useEffect(() => { if (!selectedExamId && exams[0]) setSelectedExamId(exams[0].id); }, [exams, selectedExamId]);

  const exam = exams.find(e => e.id === selectedExamId) || null;
  const localResults = getResults(selectedExamId || undefined, userId);
  const dbAsLocal = dbResults.filter(d => d.avaliacao.external_id === selectedExamId).map(dbToLocal);
  const mergedMap = new Map<string, typeof localResults[number]>();
  for (const r of [...localResults, ...dbAsLocal]) {
    const key = (r as unknown as { codigoUnico?: string }).codigoUnico || r.id;
    if (!mergedMap.has(key)) mergedMap.set(key, r);
  }
  const results = Array.from(mergedMap.values());

  const stats = useMemo(() => {
    if (!results.length) return null;
    const grades = results.map(r => r.grade).sort((a,b)=>a-b);
    const avg = grades.reduce((a,b)=>a+b,0)/grades.length;
    const median = grades[Math.floor(grades.length/2)];
    const max = Math.max(...grades);
    const min = Math.min(...grades);
    const buckets = Array(11).fill(0).map((_,i)=>({ name: String(i), count: 0 }));
    for (const g of grades) buckets[Math.min(10, Math.max(0, Math.round(g)))].count++;
    const qTotal = exam?.totalQuestions || 44;
    const qCorrect: Record<number, number> = {};
    const qAttempts: Record<number, number> = {};
    for (let q=1; q<=qTotal; q++) { qCorrect[q]=0; qAttempts[q]=0; }
    for (const r of results) {
      for (let q=1; q<=qTotal; q++) {
        const ans = r.answers[q];
        const correct = exam?.answerKey?.[q];
        if (!correct) continue;
        qAttempts[q]++;
        if (ans === correct) qCorrect[q]++;
      }
    }
    const perQuestion = Object.keys(qCorrect).map(k => {
      const q = Number(k);
      const pct = qAttempts[q] ? Math.round(qCorrect[q]/qAttempts[q]*100) : 0;
      return { name: `Q${q}`, q, pct, correct: qCorrect[q], total: qAttempts[q] };
    });
    const hardest = [...perQuestion].sort((a,b)=>a.pct-b.pct).slice(0,3);
    const easiest = [...perQuestion].sort((a,b)=>b.pct-a.pct).slice(0,3);
    return { avg, median, max, min, buckets, perQuestion, hardest, easiest, count: results.length };
  }, [results, exam]);

  if (exams.length===0) {
    return <EmptyState title="Nenhuma prova cadastrada" description="Crie sua primeira prova para ver o dashboard." action={<button onClick={()=>onNavigate('new-exam')} className="btn btn-primary mt-1">Criar Prova</button>} />;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral da prova selecionada"
        actions={<><select className="input sm:w-64" value={selectedExamId} onChange={e=>setSelectedExamId(e.target.value)} aria-label="Selecionar prova">
          {exams.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </select><ThemeToggle /></>}
      />

      {!exam ? null : !exam.answerKey ? (
        <EmptyState title="Cadastre o gabarito" description="Para ver estatísticas por questão." action={<button onClick={()=>onNavigate('register-key', exam.id)} className="btn btn-primary mt-1">Cadastrar Gabarito</button>} />
      ) : loading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3" role="status" aria-label="Carregando dashboard">{Array(5).fill(0).map((_,i)=><div key={i} className="card skeleton h-24" />)}</div>
      ) : !stats ? (
        <EmptyState title="Nenhum resultado para esta prova" description="Corrija cartões em “Corrigir Cartão”." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Alunos" value={stats.count} />
            <StatCard label="Média" value={stats.avg.toFixed(1)} tone="info" />
            <StatCard label="Mediana" value={stats.median.toFixed(1)} />
            <StatCard label="Maior" value={stats.max.toFixed(1)} tone="success" />
            <StatCard label="Menor" value={stats.min.toFixed(1)} tone="danger" />
          </div>

          <div className="card card-hover">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Distribuição de notas (0-10)</h3>
            <div style={{ height: 140 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.buckets}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400 mt-2"><span>Mais difíceis: {stats.hardest.map(h=>`Q${h.q} ${h.pct}%`).join(' · ')}</span><span>Mais fáceis: {stats.easiest.map(h=>`Q${h.q} ${h.pct}%`).join(' · ')}</span></div>
          </div>

          <div className="card card-hover">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Acerto por questão (%)</h3>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.perQuestion}>
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} />
                  <YAxis domain={[0,100]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: unknown)=> `${v as number}%`} />
                  <Bar dataKey="pct" radius={[4,4,0,0]}>
                    {stats.perQuestion.map((p,i)=><Cell key={i} fill={p.pct>=70 ? '#16a34a' : p.pct>=40 ? '#f59e0b' : '#dc2626'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card card-hover">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Ranking por aluno</h3>
            <DataTable
              rows={[...results].sort((a,b)=>b.grade-a.grade)}
              rowKey={(r) => r.id}
              columns={[
                { key: 'name', header: 'Aluno', render: (r) => <span className="font-medium dark:text-white">{r.studentName}</span> },
                { key: 'hits', header: 'Acertos', className: 'text-center', render: (r) => <span className="text-emerald-600">{r.correctCount}/{exam.totalQuestions}</span> },
                { key: 'grade', header: 'Nota', className: 'text-center', render: (r) => <span className="font-bold text-blue-600">{r.grade}</span> },
                { key: 'act', header: 'Ação', className: 'text-center', render: (r) => <button onClick={()=>onNavigate('view-result', r.id)} className="btn btn-sm btn-secondary min-h-[44px]">Ver</button> },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
