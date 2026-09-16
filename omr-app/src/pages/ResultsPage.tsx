import { useState, useEffect } from 'react';
import { AppView } from '../types';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import { getResults, getExams, deleteResult } from '../utils/storage';
import { downloadCSV, downloadXLSX } from '../utils/export';
import { computeSubjectStats } from '../utils/exam';
import { getResultadosFromDB, deleteResultadoDB, DBResultado } from '../utils/api';
import { useAuth } from '../context/AuthContext';

interface Props {
  onNavigate: (view: AppView, resultId?: string) => void;
}

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

export default function ResultsPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const userId = user?.id;

  const [results, setResults] = useState(() => getResults(undefined, userId));
  const [exams, setExams] = useState(() => getExams(userId));
  const [dbResults, setDbResults] = useState<DBResultado[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterExamId, setFilterExamId] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'grade'>('date');

  useEffect(() => {
    getResultadosFromDB().then(setDbResults).catch(() => {});
  }, []);

  const dbAsLocal = dbResults.map(dbToLocal);
  const mergedMap = new Map<string, typeof results[number]>();
  for (const r of [...results, ...dbAsLocal]) {
    const key = (r as unknown as { codigoUnico?: string }).codigoUnico || r.id;
    if (!mergedMap.has(key)) mergedMap.set(key, r);
  }
  const allResults = Array.from(mergedMap.values());

  const filtered = allResults
    .filter(r => {
      if (searchTerm && !r.studentName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (filterExamId && r.examId !== filterExamId) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.studentName.localeCompare(b.studentName);
      if (sortBy === 'grade') return b.grade - a.grade;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

  const handleExportCSV = () => downloadCSV(filtered, exams);
  const handleExportXLSX = () => downloadXLSX(filtered, exams);

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este resultado?')) return;
    const r = allResults.find(x => x.id === id) as unknown as { codigoUnico?: string } | undefined;
    const codigo = r?.codigoUnico;
    if (codigo) {
      try { await deleteResultadoDB(codigo); } catch { /* segue para local */ }
      setDbResults(prev => prev.filter(d => d.codigo_unico !== codigo));
    }
    deleteResult(id, userId);
    setResults(getResults(undefined, userId));
    setExams(getExams(userId));
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Resultados"
        subtitle={`${filtered.length} resultado(s) encontrado(s)`}
        actions={<>
          <button onClick={handleExportCSV} className="btn btn-secondary btn-sm min-h-[44px]" disabled={filtered.length === 0}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            CSV
          </button>
          <button onClick={handleExportXLSX} className="btn btn-primary btn-sm min-h-[44px]" disabled={filtered.length === 0}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            XLSX
          </button>
        </>}
      />

      <div className="card mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            className="input flex-1"
            placeholder="Buscar pelo nome do aluno..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <select
            className="input sm:w-48"
            value={filterExamId}
            onChange={(e) => setFilterExamId(e.target.value)}
          >
            <option value="">Todas as provas</option>
            {exams.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <select
            className="input sm:w-40"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          >
            <option value="date">Mais recentes</option>
            <option value="name">Nome (A-Z)</option>
            <option value="grade">Melhor nota</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nenhum resultado encontrado"
          description={allResults.length === 0 ? 'Corrija cartões-resposta para ver os resultados aqui.' : 'Tente ajustar os filtros de busca.'}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-3 px-3 text-left font-medium text-gray-500">Aluno</th>
                <th className="py-3 px-3 text-left font-medium text-gray-500 hidden sm:table-cell">Prova</th>
                <th className="py-3 px-3 text-left font-medium text-gray-500 hidden md:table-cell">Data/Hora</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500">✓</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500">✗</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500">—</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500">Nota</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500 hidden lg:table-cell">LP</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500 hidden lg:table-cell">MAT</th>
                <th className="py-3 px-3 text-center font-medium text-gray-500">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const exam = exams.find(e => e.id === r.examId);
                const subjectStats = exam ? computeSubjectStats(exam, r.answers, r.duplicateQuestions ?? []) : null;
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-3 font-medium text-gray-900">{r.studentName}</td>
                    <td className="py-3 px-3 text-gray-500 hidden sm:table-cell">{exam?.name || '—'}</td>
                    <td className="py-3 px-3 text-gray-400 text-xs hidden md:table-cell">
                      {new Date(r.timestamp).toLocaleString('pt-BR')}
                    </td>
                    <td className="py-3 px-3 text-center text-emerald-600 font-medium">{r.correctCount}</td>
                    <td className="py-3 px-3 text-center text-red-600 font-medium">{r.incorrectCount}</td>
                    <td className="py-3 px-3 text-center text-gray-400">{r.blankCount}</td>
                    <td className="py-3 px-3 text-center font-bold text-blue-600">{r.grade}</td>
                    <td className="py-3 px-3 text-center text-gray-600 hidden lg:table-cell">
                      {subjectStats ? `${subjectStats.lp.correctCount}/${exam?.questionsPerSubject}` : '—'}
                    </td>
                    <td className="py-3 px-3 text-center text-gray-600 hidden lg:table-cell">
                      {subjectStats ? `${subjectStats.mat.correctCount}/${exam?.questionsPerSubject}` : '—'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => onNavigate('view-result', r.id)} className="btn btn-sm btn-secondary">
                          Ver
                        </button>
                        <button onClick={() => handleDelete(r.id)} className="btn btn-sm btn-danger">
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
