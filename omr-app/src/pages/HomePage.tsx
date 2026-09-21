import { AppView } from '../types';
import { getExams, getResults } from '../utils/storage';
import { pendingFromResults } from '../utils/pending';
import { useAuth } from '../context/AuthContext';

interface Props {
  onNavigate: (view: AppView, examId?: string) => void;
}

export default function HomePage({ onNavigate }: Props) {
  const { user } = useAuth();
  const exams = getExams(user?.id);
  const results = getResults(undefined, user?.id);
  const pending = pendingFromResults(results);
  const examName = (id: string) => exams.find((e) => e.id === id)?.name ?? 'Prova';

  const features = [
    ...(user?.role === 'admin'
      ? [
          {
            title: 'Usuários',
            desc: 'Gerencie acesso e papéis (exclusivo admin)',
            view: 'admin-users' as AppView,
            color: 'bg-slate-700',
            icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
          },
        ]
      : []),
    {
      title: 'Nova Prova',
      desc: 'Crie uma nova prova com 44 questões (22 por disciplina)',
      view: 'new-exam' as AppView,
      color: 'bg-blue-500',
      icon: 'M12 4v16m8-8H4',
    },
    {
      title: 'Gerar Cartão',
      desc: 'Gere o cartão-resposta em formato A4',
      view: 'generate-card' as AppView,
      color: 'bg-emerald-500',
      icon: 'M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z',
    },
    {
      title: 'Importar Alunos',
      desc: 'Um gabarito personalizado por aluno a partir de XLSX/CSV',
      view: 'import-students' as AppView,
      color: 'bg-cyan-500',
      icon: 'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    },
    {
      title: 'Gerenciar Avaliação',
      desc: 'Alunos, gabaritos e status de correção (banco de dados)',
      view: 'manage-exam' as AppView,
      color: 'bg-teal-600',
      icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2m-6 9l2 2 4-4',
    },
    {
      title: 'Cadastrar Gabarito',
      desc: 'Defina as respostas corretas da prova',
      view: 'register-key' as AppView,
      color: 'bg-amber-500',
      icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    {
      title: 'Corrigir Cartão',
      desc: 'Capture ou envie a foto do cartão preenchido',
      view: 'correct-card' as AppView,
      color: 'bg-purple-500',
      icon: 'M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z',
    },
    {
      title: 'Resultados',
      desc: 'Veja todas as correções realizadas',
      view: 'results' as AppView,
      color: 'bg-rose-500',
      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Painel de Controle</h1>
        <p className="text-gray-500">Sistema de geração, leitura e correção de cartões-resposta</p>
      </div>

      {pending.length > 0 && (
        <div className="card mb-6 border-amber-200 bg-amber-50/60">
          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            ⚠ Pendências de revisão ({pending.length})
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Cartões com dupla marcação, leitura incerta ou QR ilegível — revise antes de fechar a prova.
          </p>
          <div className="space-y-2">
            {pending.map((item) => (
              <div key={item.resultId} className="flex flex-wrap items-center gap-2 p-3 bg-white rounded-lg border border-amber-100">
                <div className="flex-1 min-w-[140px]">
                  <p className="font-medium text-gray-900 text-sm">
                    {item.studentName || '(sem identificação)'}
                  </p>
                  <p className="text-xs text-gray-500">{examName(item.examId)}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {item.duplicateQuestions.length > 0 && (
                    <span className="text-xs font-medium bg-orange-100 text-orange-700 px-2 py-1 rounded-full">
                      {item.duplicateQuestions.length} duplicada(s)
                    </span>
                  )}
                  {item.lowConfidence.length > 0 && (
                    <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                      {item.lowConfidence.length} incerta(s)
                    </span>
                  )}
                  {item.qrIssue && (
                    <span className="text-xs font-medium bg-red-100 text-red-700 px-2 py-1 rounded-full">
                      QR ilegível
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => onNavigate('view-result', item.resultId)}
                    className="btn btn-sm btn-secondary min-h-[44px]"
                  >
                    Ver
                  </button>
                  <button
                    onClick={() => onNavigate('correct-card', item.examId)}
                    className="btn btn-sm btn-primary min-h-[44px]"
                  >
                    Recorrigir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {features.map((f) => (
          <button
            key={f.view}
            onClick={() => onNavigate(f.view)}
            className="card hover:shadow-md transition-all duration-200 text-left group"
          >
            <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={f.icon} />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{f.title}</h3>
            <p className="text-sm text-gray-500">{f.desc}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Resumo</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <p className="text-2xl font-bold text-blue-600">{exams.length}</p>
              <p className="text-sm text-blue-600/70">Provas criadas</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-4">
              <p className="text-2xl font-bold text-emerald-600">{results.length}</p>
              <p className="text-sm text-emerald-600/70">Cartões corrigidos</p>
            </div>
          </div>
        </div>

        {exams.length > 0 && (
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Provas Recentes</h3>
            <div className="space-y-2">
              {exams.slice(-3).reverse().map((exam) => (
                <div key={exam.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{exam.name}</p>
                    <p className="text-xs text-gray-500">{exam.subjectLP} + {exam.subjectMat} — {exam.totalQuestions} questões</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onNavigate('generate-card', exam.id)}
                      className="btn btn-sm btn-secondary"
                    >
                      Cartão
                    </button>
                    <button
                      onClick={() => onNavigate('correct-card', exam.id)}
                      className="btn btn-sm btn-primary"
                    >
                      Corrigir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
